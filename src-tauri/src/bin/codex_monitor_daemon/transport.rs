use super::rpc::{
    build_error_response, build_result_response, forward_events, parse_auth_token,
    spawn_rpc_response_task,
};
use super::*;

fn start_event_forwarding_task(
    events: &broadcast::Sender<DaemonEvent>,
    out_tx: mpsc::UnboundedSender<String>,
) -> tokio::task::JoinHandle<()> {
    let rx = events.subscribe();
    tokio::spawn(forward_events(rx, out_tx))
}

fn handle_rpc_json_message(
    message: Value,
    state: &Arc<DaemonState>,
    events: &broadcast::Sender<DaemonEvent>,
    expected_token: Option<&str>,
    out_tx: &mpsc::UnboundedSender<String>,
    authenticated: &mut bool,
    events_task: &mut Option<tokio::task::JoinHandle<()>>,
    client_version: &str,
    request_limiter: &Arc<Semaphore>,
) {
    let id = message.get("id").and_then(|value| value.as_u64());
    let method = message
        .get("method")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if method.is_empty() {
        return;
    }

    if !*authenticated {
        if method != "auth" {
            if let Some(response) = build_error_response(id, "unauthorized") {
                let _ = out_tx.send(response);
            }
            return;
        }

        let expected = expected_token.unwrap_or_default();
        let provided = parse_auth_token(&params).unwrap_or_default();
        if expected != provided {
            if let Some(response) = build_error_response(id, "invalid token") {
                let _ = out_tx.send(response);
            }
            return;
        }

        *authenticated = true;
        if let Some(response) = build_result_response(id, json!({ "ok": true })) {
            let _ = out_tx.send(response);
        }
        if events_task.is_none() {
            *events_task = Some(start_event_forwarding_task(events, out_tx.clone()));
        }
        return;
    }

    spawn_rpc_response_task(
        Arc::clone(state),
        out_tx.clone(),
        id,
        method,
        params,
        client_version.to_string(),
        Arc::clone(request_limiter),
    );
}

fn handle_rpc_line(
    line: &str,
    state: &Arc<DaemonState>,
    events: &broadcast::Sender<DaemonEvent>,
    expected_token: Option<&str>,
    out_tx: &mpsc::UnboundedSender<String>,
    authenticated: &mut bool,
    events_task: &mut Option<tokio::task::JoinHandle<()>>,
    client_version: &str,
    request_limiter: &Arc<Semaphore>,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    let message: Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(_) => return,
    };

    handle_rpc_json_message(
        message,
        state,
        events,
        expected_token,
        out_tx,
        authenticated,
        events_task,
        client_version,
        request_limiter,
    );
}

pub(super) async fn handle_client(
    socket: TcpStream,
    config: Arc<DaemonConfig>,
    state: Arc<DaemonState>,
    events: broadcast::Sender<DaemonEvent>,
) {
    let (reader, mut writer) = socket.into_split();
    let mut lines = BufReader::new(reader).lines();

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let write_task = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            if writer.write_all(message.as_bytes()).await.is_err() {
                break;
            }
            if writer.write_all(b"\n").await.is_err() {
                break;
            }
        }
    });

    let mut authenticated = config.token.is_none();
    let mut events_task: Option<tokio::task::JoinHandle<()>> = None;
    let request_limiter = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RPC_PER_CONNECTION));
    let client_version = format!("daemon-{}", env!("CARGO_PKG_VERSION"));

    if authenticated {
        events_task = Some(start_event_forwarding_task(&events, out_tx.clone()));
    }

    while let Ok(Some(line)) = lines.next_line().await {
        handle_rpc_line(
            &line,
            &state,
            &events,
            config.token.as_deref(),
            &out_tx,
            &mut authenticated,
            &mut events_task,
            &client_version,
            &request_limiter,
        );
    }

    drop(out_tx);
    if let Some(task) = events_task {
        task.abort();
    }
    write_task.abort();
}

async fn handle_ws_client(
    socket: TcpStream,
    config: Arc<DaemonConfig>,
    state: Arc<DaemonState>,
    events: broadcast::Sender<DaemonEvent>,
) {
    let stream = match tokio_tungstenite::accept_async(socket).await {
        Ok(stream) => stream,
        Err(err) => {
            eprintln!("websocket handshake failed: {err}");
            return;
        }
    };

    let (mut writer, mut reader) = stream.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let write_task = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            if writer.send(Message::Text(message.into())).await.is_err() {
                break;
            }
        }
    });

    let mut authenticated = config.token.is_none();
    let mut events_task: Option<tokio::task::JoinHandle<()>> = None;
    let request_limiter = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RPC_PER_CONNECTION));
    let client_version = format!("daemon-{}", env!("CARGO_PKG_VERSION"));

    if authenticated {
        events_task = Some(start_event_forwarding_task(&events, out_tx.clone()));
    }

    while let Some(frame) = reader.next().await {
        match frame {
            Ok(Message::Text(text)) => {
                for line in text.lines() {
                    handle_rpc_line(
                        line,
                        &state,
                        &events,
                        config.token.as_deref(),
                        &out_tx,
                        &mut authenticated,
                        &mut events_task,
                        &client_version,
                        &request_limiter,
                    );
                }
            }
            Ok(Message::Binary(bytes)) => {
                if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                    for line in text.lines() {
                        handle_rpc_line(
                            line,
                            &state,
                            &events,
                            config.token.as_deref(),
                            &out_tx,
                            &mut authenticated,
                            &mut events_task,
                            &client_version,
                            &request_limiter,
                        );
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
            Ok(Message::Frame(_)) => {}
            Err(err) => {
                eprintln!("websocket client error: {err}");
                break;
            }
        }
    }

    drop(out_tx);
    if let Some(task) = events_task {
        task.abort();
    }
    write_task.abort();
}

async fn run_websocket_accept_loop(
    listener: TcpListener,
    config: Arc<DaemonConfig>,
    state: Arc<DaemonState>,
    events: broadcast::Sender<DaemonEvent>,
) {
    loop {
        match listener.accept().await {
            Ok((socket, _addr)) => {
                let config = Arc::clone(&config);
                let state = Arc::clone(&state);
                let events = events.clone();
                tokio::spawn(async move {
                    handle_ws_client(socket, config, state, events).await;
                });
            }
            Err(_) => continue,
        }
    }
}

pub(super) async fn run_tcp_mode(
    config: Arc<DaemonConfig>,
    state: Arc<DaemonState>,
    events_tx: broadcast::Sender<DaemonEvent>,
) {
    let listener = match TcpListener::bind(config.listen).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("failed to bind {}: {err}", config.listen);
            std::process::exit(2);
        }
    };
    eprintln!(
        "codex-monitor-daemon listening on {} (data dir: {})",
        config.listen,
        state
            .storage_path
            .parent()
            .unwrap_or(&state.storage_path)
            .display()
    );

    if let Some(ws_listen) = config.ws_listen {
        match TcpListener::bind(ws_listen).await {
            Ok(ws_listener) => {
                eprintln!("codex-monitor-daemon websocket listening on {}", ws_listen);
                let ws_config = Arc::clone(&config);
                let ws_state = Arc::clone(&state);
                let ws_events = events_tx.clone();
                tokio::spawn(async move {
                    run_websocket_accept_loop(ws_listener, ws_config, ws_state, ws_events).await;
                });
            }
            Err(err) => {
                eprintln!(
                    "websocket listener disabled; failed to bind {}: {}",
                    ws_listen, err
                );
            }
        }
    }

    loop {
        match listener.accept().await {
            Ok((socket, _addr)) => {
                let config = Arc::clone(&config);
                let state = Arc::clone(&state);
                let events = events_tx.clone();
                tokio::spawn(async move {
                    handle_client(socket, config, state, events).await;
                });
            }
            Err(_) => continue,
        }
    }
}

fn handle_orbit_line(
    line: &str,
    state: Arc<DaemonState>,
    out_tx: mpsc::UnboundedSender<String>,
    client_version: String,
    request_limiter: Arc<Semaphore>,
) {
    let message: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return,
    };

    if let Some(message_type) = message.get("type").and_then(Value::as_str) {
        if message_type.eq_ignore_ascii_case("ping") {
            let _ = out_tx.send(json!({ "type": "pong" }).to_string());
        }
        return;
    }

    let id = message.get("id").and_then(|value| value.as_u64());
    let method = message
        .get("method")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if method.is_empty() {
        return;
    }

    if method == "auth" {
        if let Some(response) = build_result_response(id, json!({ "ok": true })) {
            let _ = out_tx.send(response);
        }
        return;
    }

    spawn_rpc_response_task(
        state,
        out_tx,
        id,
        method,
        params,
        client_version,
        request_limiter,
    );
}

pub(super) async fn run_orbit_mode(
    config: Arc<DaemonConfig>,
    state: Arc<DaemonState>,
    events_tx: broadcast::Sender<DaemonEvent>,
) {
    let orbit_url = config.orbit_url.clone().unwrap_or_default();
    let runner_name = config
        .orbit_runner_name
        .clone()
        .unwrap_or_else(|| "codex-monitor-daemon".to_string());

    let mut reconnect_delay = Duration::from_secs(1);
    loop {
        let ws_url =
            match shared::orbit_core::build_orbit_ws_url(&orbit_url, config.orbit_token.as_deref())
            {
                Ok(value) => value,
                Err(err) => {
                    eprintln!("invalid orbit url: {err}");
                    sleep(reconnect_delay).await;
                    reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(20));
                    continue;
                }
            };

        let stream = match connect_async(&ws_url).await {
            Ok((stream, _response)) => stream,
            Err(err) => {
                eprintln!(
                    "orbit runner failed to connect to {}: {}. retrying in {}s",
                    ws_url,
                    err,
                    reconnect_delay.as_secs()
                );
                sleep(reconnect_delay).await;
                reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(20));
                continue;
            }
        };

        reconnect_delay = Duration::from_secs(1);
        eprintln!("orbit runner connected to {}", ws_url);

        let (mut writer, mut reader) = stream.split();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

        let write_task = tokio::spawn(async move {
            while let Some(message) = out_rx.recv().await {
                if writer.send(Message::Text(message.into())).await.is_err() {
                    break;
                }
            }
        });

        let events_task = {
            let rx = events_tx.subscribe();
            let out_tx_events = out_tx.clone();
            tokio::spawn(forward_events(rx, out_tx_events))
        };

        let _ = out_tx.send(
            json!({
                "type": "anchor.hello",
                "name": runner_name.clone(),
                "platform": std::env::consts::OS,
                "authUrl": config.orbit_auth_url.clone(),
            })
            .to_string(),
        );

        let client_version = format!("daemon-{}", env!("CARGO_PKG_VERSION"));
        let request_limiter = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RPC_PER_CONNECTION));
        while let Some(frame) = reader.next().await {
            match frame {
                Ok(Message::Text(text)) => {
                    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                        handle_orbit_line(
                            line,
                            Arc::clone(&state),
                            out_tx.clone(),
                            client_version.clone(),
                            Arc::clone(&request_limiter),
                        );
                    }
                }
                Ok(Message::Binary(bytes)) => {
                    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                        for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                            handle_orbit_line(
                                line,
                                Arc::clone(&state),
                                out_tx.clone(),
                                client_version.clone(),
                                Arc::clone(&request_limiter),
                            );
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                Ok(Message::Frame(_)) => {}
                Err(err) => {
                    eprintln!("orbit runner connection error: {err}");
                    break;
                }
            }
        }

        drop(out_tx);
        events_task.abort();
        write_task.abort();

        eprintln!(
            "orbit runner disconnected. reconnecting in {}s",
            reconnect_delay.as_secs()
        );
        sleep(reconnect_delay).await;
        reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(20));
    }
}
