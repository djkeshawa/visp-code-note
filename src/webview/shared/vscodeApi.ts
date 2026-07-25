interface VsCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(state: State): void;
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;

export interface MessageSender<Message> {
  postMessage(message: Message): void;
}

export function acquireMessageSender<Message>(): MessageSender<Message> {
  const api = acquireVsCodeApi();
  return {
    postMessage(message: Message): void {
      api.postMessage(message);
    },
  };
}
