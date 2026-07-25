<script lang="ts">
    import { onMount } from 'svelte';
    import { autocompletion } from '@codemirror/autocomplete';
    import { lintGutter, linter } from '@codemirror/lint';
    import CodeMirror, { type CodeMirrorProps } from 'svelte-codemirror-editor';

    import { expr } from './language';
    import { getExprAutocomplete } from './autocomplete';
    import { getExprLinter } from './linter';
    import { initWasm, isWasmReady } from './wasmLoader';

    interface Props extends CodeMirrorProps{
        environment?: Record<string, any>;
    }

    let {
        environment = {},
        value = $bindable(''),
        ...restProps
    }: Props = $props();

    let wasmLoaded = $state(isWasmReady());

    const envJson = $derived(JSON.stringify(environment));

    const extensions = $derived.by(() => {
        let parsedEnv = {};

        try {
            parsedEnv = JSON.parse(envJson);
        } catch {}

        return [
            expr(),
            lintGutter(),
            linter(getExprLinter(envJson), { delay: 300 }),
            autocompletion({
                override: [getExprAutocomplete(parsedEnv)]
            })
        ];
    });

    onMount(() => {
        (async () => {
            if (!wasmLoaded) {
                try {
                    await initWasm();
                    wasmLoaded = true;
                } catch (e) {
                    console.error('Failed to load expr wasm', e);
                }
            }
        })();
    });
</script>

<div class="expr-editor-wrapper">
    <CodeMirror
        bind:value={value}
        {...restProps}
        extensions={extensions}
    />
</div>

<style>
    .expr-editor-wrapper {
        border: 1px solid #ddd;
        border-radius: 4px;
        overflow: hidden;
    }
</style>
