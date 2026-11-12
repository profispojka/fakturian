interface StageRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface StageCameraState {
	x?: number | null;
	y?: number | null;
	zoom?: number;
}

interface StageInitOptions {
	accent?: string;
	cameraTarget?: string;
	mark?: string;
	hideScrollbars?: boolean;
	freezeMotion?: boolean;
}

interface StageCursorOptions {
	pressed?: boolean;
	opacity?: number;
}

interface StageCard {
	kicker?: string;
	title?: string;
	subtitle?: string;
	background?: string;
	color?: string;
}

interface StageApi {
	init(options?: StageInitOptions): boolean;
	measure(selector: string | Element): StageRect | null;
	measureScreen(selector: string | Element): StageRect | null;
	viewport(): { width: number; height: number };
	camera(state?: StageCameraState): boolean;
	cursor(x: number, y: number, options?: StageCursorOptions): void;
	hideCursor(): void;
	ripple(x: number, y: number, progress?: number | null): void;
	caption(text?: string | null, opacity?: number): void;
	chip(text?: string | null, opacity?: number): void;
	card(data?: StageCard | null, opacity?: number): void;
	veil(opacity?: number): void;
	reset(): void;
	hide(): void;
	show(): void;
}

interface Window {
	__DEMO_MODE__?: boolean;
	__TAURI_INTERNALS__?: {
		invoke(command: string, args?: unknown): Promise<unknown>;
		transformCallback?(callback: (...args: unknown[]) => unknown, once?: boolean): unknown;
		[key: string]: unknown;
	};
	__stage?: StageApi;
	__stageCameraTarget?: string;
	[key: string]: unknown;
}
