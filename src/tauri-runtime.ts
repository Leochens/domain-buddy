import { invoke } from "@tauri-apps/api/core";

export function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览模式不能调用供应商 API，请使用 Tauri 桌面应用。");
  }
  return invoke<T>(command, args);
}
