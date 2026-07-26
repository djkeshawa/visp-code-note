interface VsCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(state: State): void;
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;

export interface MessageSender<Message> {
  postMessage(message: Message): void;
}

export interface WebviewApi<Message, State> extends MessageSender<Message> {
  getState(): State | undefined;
  setState(state: State): void;
}

export function acquireWebviewApi<Message, State>(): WebviewApi<Message, State> {
  const api = acquireVsCodeApi<State>();
  return {
    postMessage(message: Message): void {
      api.postMessage(message);
    },
    getState(): State | undefined {
      return api.getState();
    },
    setState(state: State): void {
      api.setState(state);
    },
  };
}

export function acquireMessageSender<Message>(): MessageSender<Message> {
  return acquireWebviewApi<Message, unknown>();
}
