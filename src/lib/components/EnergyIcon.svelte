<script lang="ts">
	interface Props {
		name: string;
		bold?: boolean;
		size?: string | number;
		class?: string;
		ariaHidden?: boolean;
		ariaLabel?: string;
	}

	let {
		name,
		bold = true,
		size = '1.1em',
		class: className = '',
		ariaHidden = true,
		ariaLabel
	}: Props = $props();

	let fontSize = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<i
	class="{bold ? 'ei-b' : 'ei'} ei-{name} {className}"
	style="font-size: {fontSize}; vertical-align: -0.15em; display: inline-block; line-height: 1;"
	aria-hidden={ariaHidden ? 'true' : undefined}
	aria-label={ariaLabel}
></i>
