import { EXTENSION_FOLDER_PATH, SETTINGS_KEY, notifyWarning } from './common.js';

export const SETTINGS_TEMPLATE = `${EXTENSION_FOLDER_PATH}/settings.html`;
const TEMPLATE_EXTENSION_NAME = 'third-party/feedPros';
export const DEFAULT_SETTINGS = Object.freeze({
    staticPrompt: '',
    useDifferentProfile: false,
    profileName: '',
    useDifferentApiPreset: false,
    apiPresets: {},
    undoBuffer: null,
});

let settings;

function cloneDefault(value) {
    return value && typeof value === 'object' ? structuredClone(value) : value;
}

export function loadSettings(context) {
    if (!context?.extensionSettings) {
        return null;
    }

    context.extensionSettings[SETTINGS_KEY] ??= {};
    settings = context.extensionSettings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = cloneDefault(value);
        }
    }
    return settings;
}

export async function renderSettings(context) {
    if (!context || typeof document === 'undefined') {
        return SETTINGS_TEMPLATE;
    }
    const host = document.querySelector('#extensions_settings');
    if (!host) {
        return null;
    }
    const html = typeof context.renderExtensionTemplateAsync === 'function'
        ? await context.renderExtensionTemplateAsync(TEMPLATE_EXTENSION_NAME, 'settings')
        : await (await fetch(SETTINGS_TEMPLATE)).text();
    host.querySelector('.feedpros-settings')?.remove();
    host.insertAdjacentHTML('beforeend', html);
    bindSettings(context);
    await refreshSettingsOptions(context);
    return SETTINGS_TEMPLATE;
}

export function saveSettings(context) {
    if (typeof context?.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    }
}

export function getSettings(context = globalThis.SillyTavern?.getContext?.()) {
    return settings ?? loadSettings(context);
}

function option(select, value, label = value) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    select.append(node);
}

function bindSettings(context) {
    const root = document.querySelector('.feedpros-settings');
    if (!root) return;
    const current = getSettings(context);
    const staticPrompt = root.querySelector('#feedpros-static-prompt');
    const profileToggle = root.querySelector('#feedpros-use-profile');
    const profile = root.querySelector('#feedpros-profile');
    const presetToggle = root.querySelector('#feedpros-use-preset');
    const preset = root.querySelector('#feedpros-preset');
    staticPrompt.value = current.staticPrompt;
    profileToggle.checked = current.useDifferentProfile;
    presetToggle.checked = current.useDifferentApiPreset;
    staticPrompt.addEventListener('input', () => {
        current.staticPrompt = staticPrompt.value;
        saveSettings(context);
    });
    root.onchange = (event) => {
        if (event.target === profileToggle) current.useDifferentProfile = profileToggle.checked;
        if (event.target === profile) current.profileName = profile.value;
        if (event.target === presetToggle) current.useDifferentApiPreset = presetToggle.checked;
        if (event.target === preset) {
            current.apiPresets[context.mainApi?.toLowerCase() ?? ''] = preset.value;
        }
        saveSettings(context);
    };
}

export async function refreshSettingsOptions(context) {
    if (typeof document === 'undefined') return;
    const current = getSettings(context);
    const profile = document.querySelector('#feedpros-profile');
    const profileToggle = document.querySelector('#feedpros-use-profile');
    const preset = document.querySelector('#feedpros-preset');
    const presetToggle = document.querySelector('#feedpros-use-preset');
    if (!profile || !preset) return;

    let profiles = [];
    try {
        const state = await context.executeSlashCommandsWithOptions('/extension-state connection-manager');
        if (state?.pipe !== 'true') throw new Error('Connection Manager is disabled');
        const result = await context.executeSlashCommandsWithOptions('/profile-list', { handleParserErrors: false });
        profiles = JSON.parse(result?.pipe ?? '[]');
    } catch {
        profileToggle.disabled = true;
        profile.disabled = true;
        current.useDifferentProfile = false;
        profileToggle.checked = false;
    }
    profile.replaceChildren();
    option(profile, '', 'Active profile');
    for (const name of profiles) option(profile, name);
    if (current.profileName && profiles.includes(current.profileName)) {
        profile.value = current.profileName;
    } else if (current.profileName) {
        current.useDifferentProfile = false;
        profileToggle.checked = false;
        notifyWarning(`Connection Profile "${current.profileName}" was not found; the option was disabled.`);
        saveSettings(context);
    }

    const api = context.mainApi?.toLowerCase() ?? '';
    const selected = current.apiPresets[api] ?? '';
    let presetNames = [];
    try {
        const raw = context.getPresetManager().getPresetList().preset_names ?? {};
        presetNames = api === 'textgenerationwebui' ? Object.values(raw) : Object.keys(raw);
    } catch {
        presetToggle.disabled = true;
        preset.disabled = true;
        current.useDifferentApiPreset = false;
    }
    preset.replaceChildren();
    option(preset, '', 'Active preset');
    for (const name of presetNames) option(preset, name);
    if (selected && presetNames.includes(selected)) {
        preset.value = selected;
    } else if (selected) {
        current.useDifferentApiPreset = false;
        presetToggle.checked = false;
        notifyWarning(`API Preset "${selected}" was not found for ${api}; the option was disabled.`);
        saveSettings(context);
    }
}
