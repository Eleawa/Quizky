declare module 'bootstrap/dist/js/bootstrap.bundle.min.js' {
	export interface BootstrapDropdown {
		show(): void;
		hide(): void;
		toggle(): void;
		dispose(): void;
	}

	export interface BootstrapDropdownConstructor {
		getOrCreateInstance(element: HTMLElement, options?: Record<string, unknown>): BootstrapDropdown;
		getInstance(element: HTMLElement): BootstrapDropdown | null;
	}

	export const Dropdown: BootstrapDropdownConstructor;
	export const Modal: unknown;
	export const Tooltip: unknown;
	export const Popover: unknown;
	export const Collapse: unknown;

	const bootstrapBundle: {
		Dropdown: BootstrapDropdownConstructor;
		[key: string]: unknown;
	};

	export default bootstrapBundle;
}
