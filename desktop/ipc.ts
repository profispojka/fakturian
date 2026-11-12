import { CLOSE_REQUESTED_EVENT, FOCUS_CHANGED_EVENT, MCP_MESSAGE_EVENT } from '~/bindings';

// Kanály mezi preloadem a hlavním procesem. Modul nesmí importovat nic z hlavního procesu: zabalí se
// i do preloadu, který v sandboxu nenačte nic kromě `electron`.
// Stryker disable next-line StringLiteral: ekvivalentní mutant, preload i okno berou jméno z konstanty.
export const INVOKE_CHANNEL = 'fakturian:invoke';
// Stryker disable next-line StringLiteral: ekvivalentní mutant, preload i okno berou jméno z konstanty.
export const LISTEN_CHANNEL = 'fakturian:listen';

export const EVENT_CHANNELS: readonly string[] = [MCP_MESSAGE_EVENT, CLOSE_REQUESTED_EVENT, FOCUS_CHANGED_EVENT];

// Odmítnutí `ipcMain.handle` by webview dostalo jako „Error invoking remote method…“, proto chyba
// putuje jako hodnota a preload z ní udělá holý řetězec.
export type IpcResult<Value = unknown> = { ok: true; value: Value } | { ok: false; error: string };
