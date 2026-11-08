<script lang="ts">
	import { gsap } from 'gsap';
	import { onMount } from 'svelte';
	import EnergyIcon from '#lib/components/EnergyIcon.svelte';
	import {
		DEFAULT_THEME_ID,
		getSystemGruvboxTheme,
		getTheme,
		THEMES,
		type ThemeDefinition
	} from '#lib/shared/themes.js';

	interface BootstrapDropdownInstance {
		show(): void;
		hide(): void;
		toggle(): void;
		dispose(): void;
	}

	function prefersReducedMotion(): boolean {
		if (typeof window === 'undefined') return true;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	let currentThemeId = $state<string>(DEFAULT_THEME_ID);
	let isSystemAuto = $state<boolean>(true);
	let activeModeFilter = $state<'all' | 'dark' | 'light'>('all');
	let searchQuery = $state<string>('');
	let triggerBtnRef: HTMLButtonElement | null = $state(null);
	let menuRef: HTMLDivElement | null = $state(null);
	let searchInputRef: HTMLInputElement | null = $state(null);
	let dropdownInstance: BootstrapDropdownInstance | null = null;
	let isClosing = false;

	let currentTheme = $derived<ThemeDefinition>(getTheme(currentThemeId));
	let darkCount = $derived(THEMES.filter((t) => t.type === 'dark').length);
	let lightCount = $derived(THEMES.filter((t) => t.type === 'light').length);

	let filteredThemes = $derived.by(() => {
		let list = THEMES;
		if (activeModeFilter !== 'all') {
			list = list.filter((theme) => theme.type === activeModeFilter);
		}
		const query = searchQuery.trim().toLowerCase();
		if (!query) return list;
		return list.filter(
			(theme) =>
				theme.name.toLowerCase().includes(query) ||
				theme.family.toLowerCase().includes(query) ||
				theme.id.toLowerCase().includes(query) ||
				theme.type.toLowerCase().includes(query)
		);
	});

	function pulseSwatches() {
		if (!triggerBtnRef || prefersReducedMotion()) return;
		const dots = triggerBtnRef.querySelectorAll('.swatch-dot');
		gsap.fromTo(
			dots,
			{ scale: 0.65 },
			{ scale: 1, duration: 0.35, stagger: 0.05, ease: 'back.out(2.5)' }
		);
	}

	function applyTheme(themeId: string, persist = true) {
		currentThemeId = themeId;
		const theme = getTheme(themeId);
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', theme.id);
			document.documentElement.setAttribute('data-bs-theme', theme.type);
			if (persist) {
				try {
					localStorage.setItem('quizky_theme', theme.id);
				} catch {
					// Ignore storage errors.
				}
			}
		}

		pulseSwatches();
		dropdownInstance?.hide();
		if (!dropdownInstance && triggerBtnRef) {
			triggerBtnRef.classList.remove('show');
			triggerBtnRef.setAttribute('aria-expanded', 'false');
			const menu = triggerBtnRef.parentElement?.querySelector('.dropdown-menu');
			menu?.classList.remove('show');
		}
		searchQuery = '';
	}

	function selectExplicitTheme(themeId: string) {
		isSystemAuto = false;
		applyTheme(themeId, true);
	}

	function selectSystemAuto() {
		isSystemAuto = true;
		try {
			localStorage.removeItem('quizky_theme');
		} catch {
			// Ignore storage errors.
		}
		const prefersLight =
			typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
		applyTheme(getSystemGruvboxTheme(Boolean(prefersLight)), false);
	}

	function handleShow() {
		if (!menuRef || prefersReducedMotion()) return;
		gsap.killTweensOf(menuRef);
		gsap.fromTo(
			menuRef,
			{
				autoAlpha: 0,
				y: -10,
				scale: 0.94,
				transformOrigin: 'top right'
			},
			{
				autoAlpha: 1,
				y: 0,
				scale: 1,
				duration: 0.24,
				ease: 'back.out(1.5)',
				overwrite: 'auto'
			}
		);

		const items = menuRef.querySelectorAll('.theme-option-row');
		if (items.length > 0) {
			const visibleItems = Array.from(items).slice(0, 8);
			gsap.fromTo(
				visibleItems,
				{
					autoAlpha: 0,
					x: -8
				},
				{
					autoAlpha: 1,
					x: 0,
					duration: 0.18,
					stagger: 0.02,
					ease: 'power2.out',
					overwrite: 'auto'
				}
			);
		}
	}

	function handleShown() {
		setTimeout(() => {
			searchInputRef?.focus();
		}, 50);
	}

	function handleHide(e: Event) {
		if (isClosing || prefersReducedMotion() || !menuRef || !dropdownInstance) return;
		e.preventDefault();
		isClosing = true;
		gsap.to(menuRef, {
			autoAlpha: 0,
			y: -6,
			scale: 0.96,
			duration: 0.15,
			ease: 'power2.in',
			onComplete: () => {
				dropdownInstance?.hide();
				isClosing = false;
				if (menuRef) {
					gsap.set(menuRef, { clearProps: 'transform,opacity,visibility' });
				}
			}
		});
	}

	function handleHidden() {
		isClosing = false;
		searchQuery = '';
		if (menuRef) {
			gsap.set(menuRef, { clearProps: 'transform,opacity,visibility' });
		}
	}

	function handleButtonMouseEnter() {
		if (!triggerBtnRef || prefersReducedMotion()) return;
		gsap.to(triggerBtnRef, {
			y: -2,
			duration: 0.14,
			ease: 'power2.out',
			overwrite: 'auto'
		});
	}

	function handleButtonMouseLeave() {
		if (!triggerBtnRef || prefersReducedMotion()) return;
		gsap.to(triggerBtnRef, {
			y: 0,
			duration: 0.14,
			ease: 'power2.out',
			overwrite: 'auto'
		});
	}

	async function initBootstrapDropdown() {
		try {
			const bsModule = await import('bootstrap/dist/js/bootstrap.bundle.min.js');
			const DropdownClass =
				bsModule.Dropdown ??
				(
					window as unknown as {
						bootstrap?: {
							Dropdown?: {
								getOrCreateInstance: (el: HTMLElement, opts?: unknown) => BootstrapDropdownInstance;
							};
						};
					}
				).bootstrap?.Dropdown;

			if (DropdownClass && triggerBtnRef) {
				dropdownInstance = DropdownClass.getOrCreateInstance(triggerBtnRef, {
					autoClose: 'outside'
				});
			}
		} catch {
			// Ignore if running without DOM/window.
		}
	}

	function handleSystemChange(e: MediaQueryListEvent) {
		if (isSystemAuto) {
			applyTheme(getSystemGruvboxTheme(e.matches), false);
		}
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem('quizky_theme');
			if (saved && saved !== 'system' && THEMES.some((t) => t.id === saved)) {
				isSystemAuto = false;
				applyTheme(saved, false);
			} else {
				isSystemAuto = true;
				const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
				applyTheme(getSystemGruvboxTheme(prefersLight), false);
			}
		} catch {
			isSystemAuto = true;
			applyTheme(DEFAULT_THEME_ID, false);
		}

		void initBootstrapDropdown();

		const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
		mediaQuery.addEventListener('change', handleSystemChange);

		const btn = triggerBtnRef;
		if (btn) {
			btn.addEventListener('show.bs.dropdown', handleShow);
			btn.addEventListener('shown.bs.dropdown', handleShown);
			btn.addEventListener('hide.bs.dropdown', handleHide);
			btn.addEventListener('hidden.bs.dropdown', handleHidden);
		}

		return () => {
			mediaQuery.removeEventListener('change', handleSystemChange);
			if (btn) {
				btn.removeEventListener('show.bs.dropdown', handleShow);
				btn.removeEventListener('shown.bs.dropdown', handleShown);
				btn.removeEventListener('hide.bs.dropdown', handleHide);
				btn.removeEventListener('hidden.bs.dropdown', handleHidden);
			}
			if (menuRef) {
				gsap.killTweensOf(menuRef);
			}
			dropdownInstance?.dispose();
		};
	});
</script>

<div class="dropdown theme-picker">
	<button
		bind:this={triggerBtnRef}
		type="button"
		class="btn btn-sm btn-outline-secondary dropdown-toggle d-inline-flex align-items-center gap-2 theme-trigger-btn"
		data-bs-toggle="dropdown"
		data-bs-auto-close="outside"
		aria-expanded="false"
		title="Theme: {isSystemAuto ? 'Gruvbox (System Auto)' : currentTheme.name}"
		onmouseenter={handleButtonMouseEnter}
		onmouseleave={handleButtonMouseLeave}
	>
		<span class="theme-swatch-badge" aria-hidden="true">
			<span class="swatch-dot" style="background-color: {currentTheme.primary}"></span>
			<span class="swatch-dot" style="background-color: {currentTheme.accent}"></span>
			<span class="swatch-dot" style="background-color: {currentTheme.bg}"></span>
		</span>
		<span class="theme-name-label">
			{#if isSystemAuto}
				Gruvbox (Auto)
			{:else}
				{currentTheme.name}
			{/if}
		</span>
		<span class="theme-trigger-mode-icon" aria-hidden="true">
			{#if currentTheme.type === 'light'}
				<EnergyIcon name="sun" size="0.85em" />
			{:else}
				<EnergyIcon name="moon" size="0.85em" />
			{/if}
		</span>
	</button>

	<div
		bind:this={menuRef}
		class="dropdown-menu dropdown-menu-end shadow p-2 theme-dropdown-menu"
		role="listbox"
		aria-label="Themes"
	>
		<div class="px-1 pb-2">
			<div class="input-group input-group-sm mb-2">
				<span class="input-group-text theme-search-addon" aria-hidden="true">
					<EnergyIcon name="search" size="0.85em" />
				</span>
				<input
					type="text"
					bind:this={searchInputRef}
					bind:value={searchQuery}
					placeholder="Search 76 themes in 38 styles…"
					class="form-control form-control-sm theme-search-input"
					aria-label="Filter themes"
				/>
				{#if searchQuery}
					<button
						type="button"
						class="btn btn-outline-secondary clear-search-btn"
						onclick={() => (searchQuery = '')}
						aria-label="Clear search"
					>
						<EnergyIcon name="close" size="0.75em" />
					</button>
				{/if}
			</div>

			<div class="theme-mode-filters" role="group" aria-label="Theme mode filter">
				<button
					type="button"
					class="mode-filter-pill"
					class:active={activeModeFilter === 'all'}
					onclick={() => (activeModeFilter = 'all')}
				>
					All ({THEMES.length})
				</button>
				<button
					type="button"
					class="mode-filter-pill"
					class:active={activeModeFilter === 'dark'}
					onclick={() => (activeModeFilter = 'dark')}
				>
					<EnergyIcon name="moon" size="0.8em" /> Dark ({darkCount})
				</button>
				<button
					type="button"
					class="mode-filter-pill"
					class:active={activeModeFilter === 'light'}
					onclick={() => (activeModeFilter = 'light')}
				>
					<EnergyIcon name="sun" size="0.8em" /> Light ({lightCount})
				</button>
			</div>
		</div>

		<div class="px-1 pb-1">
			<button
				type="button"
				class="dropdown-item d-flex align-items-center gap-2 rounded px-2 py-1.5 system-auto-row"
				class:active={isSystemAuto}
				role="option"
				aria-selected={isSystemAuto}
				onclick={selectSystemAuto}
			>
				<span class="system-auto-icon" aria-hidden="true">
					<EnergyIcon name="sun-dim" size="1.05em" />
				</span>
				<div class="system-auto-text text-truncate flex-grow-1">
					<div class="system-auto-title">Default Gruvbox (System Theme)</div>
					<div class="system-auto-desc">Chooses light or dark from your system settings</div>
				</div>
				{#if isSystemAuto}
					<span class="active-check-icon">
						<EnergyIcon name="check" size="0.95em" />
					</span>
				{/if}
			</button>
		</div>

		<hr class="dropdown-divider my-1" />

		<div class="theme-list-scroll">
			{#each filteredThemes as theme (theme.id)}
				<button
					type="button"
					class="dropdown-item d-flex align-items-center gap-2 rounded px-2 py-1 theme-option-row"
					class:active={!isSystemAuto && theme.id === currentThemeId}
					role="option"
					aria-selected={!isSystemAuto && theme.id === currentThemeId}
					onclick={() => selectExplicitTheme(theme.id)}
				>
					<span class="theme-option-swatch" aria-hidden="true">
						<span class="swatch-dot" style="background-color: {theme.primary}"></span>
						<span class="swatch-dot" style="background-color: {theme.accent}"></span>
						<span class="swatch-dot" style="background-color: {theme.bg}"></span>
					</span>
					<span class="theme-option-name text-truncate flex-grow-1">{theme.name}</span>
					<span class="badge theme-type-pill" data-type={theme.type}>
						{#if theme.type === 'light'}
							<EnergyIcon name="sun" size="0.75em" /> Light
						{:else}
							<EnergyIcon name="moon" size="0.75em" /> Dark
						{/if}
					</span>
					{#if !isSystemAuto && theme.id === currentThemeId}
						<span class="active-check-icon">
							<EnergyIcon name="check" size="0.95em" />
						</span>
					{/if}
				</button>
			{:else}
				<div class="text-muted text-center py-3 theme-empty-search">
					No themes matching "{searchQuery}"
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.theme-picker {
		position: relative;
	}

	.theme-trigger-btn {
		min-height: 2.35rem;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--gruv-bg1);
		padding: 0.35rem 0.75rem;
		color: var(--color-heading);
		font: inherit;
		font-size: 0.84rem;
		font-weight: 400;
		box-shadow: 0 2px 0 var(--gruv-bg-hard);
		transition:
			border-color 140ms ease,
			background-color 140ms ease;
	}

	.theme-trigger-btn:hover,
	.theme-trigger-btn:focus,
	:global(.theme-picker .theme-trigger-btn.show) {
		border-color: var(--color-brand);
		background: var(--gruv-bg2);
		color: var(--color-heading);
	}

	.theme-swatch-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--gruv-bg-hard);
		padding: 2px 4px;
	}

	.swatch-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		display: inline-block;
		box-shadow: 0 0 1px rgba(0, 0, 0, 0.5);
	}

	.theme-name-label {
		max-width: 9.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.theme-trigger-mode-icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-muted);
	}

	.theme-dropdown-menu {
		width: 21rem;
		max-width: 92vw;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.theme-search-addon {
		background: var(--gruv-bg-hard);
		border-color: var(--color-border);
		color: var(--color-muted);
	}

	.theme-search-input {
		background: var(--gruv-bg-hard);
		border-color: var(--color-border);
		color: var(--color-heading);
	}

	.theme-search-input:focus {
		background: var(--gruv-bg-hard);
		border-color: var(--color-brand);
		color: var(--color-heading);
		box-shadow: none;
	}

	.clear-search-btn {
		border-color: var(--color-border);
		color: var(--color-muted);
	}

	.clear-search-btn:hover {
		border-color: var(--color-brand);
		color: var(--color-heading);
		background: var(--gruv-bg-soft);
	}

	.theme-mode-filters {
		display: flex;
		gap: 0.25rem;
		background: var(--gruv-bg-hard);
		padding: 0.2rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
	}

	.mode-filter-pill {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		border: none;
		border-radius: calc(var(--radius-sm) - 2px);
		background: transparent;
		color: var(--color-muted);
		font-size: 0.72rem;
		font-weight: 500;
		padding: 0.25rem 0.4rem;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.mode-filter-pill:hover {
		color: var(--color-heading);
		background: var(--gruv-bg-soft);
	}

	.mode-filter-pill.active {
		background: var(--color-brand);
		color: var(--gruv-bg-hard);
		font-weight: 700;
	}

	.system-auto-row {
		border: 1px solid var(--color-border);
		background: var(--gruv-bg-hard);
		color: var(--color-ink);
		font: inherit;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.system-auto-row:hover,
	.system-auto-row:focus {
		border-color: var(--color-brand);
		background-color: var(--gruv-bg-soft);
		color: var(--color-heading);
	}

	.system-auto-row.active {
		border-color: var(--color-brand);
		background-color: var(--gruv-bg1);
		color: var(--color-heading);
	}

	.system-auto-icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-brand);
		flex-shrink: 0;
	}

	.system-auto-title {
		font-size: 0.8rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.system-auto-desc {
		font-size: 0.68rem;
		color: var(--color-muted);
		line-height: 1.2;
	}

	.theme-list-scroll {
		max-height: 20rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-right: 0.25rem;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.theme-list-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.theme-list-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.theme-list-scroll::-webkit-scrollbar-thumb {
		background-color: var(--color-border);
		border-radius: 999px;
		border: 1px solid transparent;
		background-clip: content-box;
	}

	.theme-list-scroll::-webkit-scrollbar-thumb:hover {
		background-color: var(--color-brand);
	}

	.theme-option-row {
		border: 1px solid transparent;
		color: var(--color-ink);
		font: inherit;
		font-size: 0.82rem;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.theme-option-row:hover,
	.theme-option-row:focus {
		border-color: var(--color-border);
		background-color: var(--gruv-bg-soft);
		color: var(--color-heading);
	}

	.theme-option-row.active {
		border-color: var(--color-brand);
		background-color: var(--gruv-bg1);
		color: var(--color-heading);
		font-weight: 700;
	}

	.theme-option-swatch {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--gruv-bg-hard);
		padding: 2px 4px;
		flex-shrink: 0;
	}

	.theme-type-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.15rem 0.45rem;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted);
		background: var(--gruv-bg-hard);
		font-weight: 500;
	}

	.theme-type-pill[data-type='light'] {
		color: #e6b450;
		border-color: #e6b450;
	}

	.active-check-icon {
		display: inline-flex;
		align-items: center;
		color: var(--color-brand);
		flex-shrink: 0;
	}

	.theme-empty-search {
		font-size: 0.82rem;
	}

	@media (max-width: 36rem) {
		.theme-name-label {
			display: none;
		}

		.theme-dropdown-menu {
			width: 18rem;
		}
	}
</style>
