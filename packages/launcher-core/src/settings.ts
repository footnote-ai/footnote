/**
 * @description: Best-effort settings patch helpers for launcher-selected local web origins.
 * @footnote-scope: utility
 * @footnote-module: LauncherSettings
 * @footnote-risk: medium - Incorrect YAML edits can degrade local runtime configuration behavior.
 * @footnote-ethics: low - Local config patching improves operator ergonomics without changing governance semantics.
 */

import { readFile, writeFile } from 'node:fs/promises';

const WEB_SECTION_KEY = 'web:';
const ALLOWED_ORIGINS_KEY = 'allowed-origins:';
const FRAME_ANCESTORS_KEY = 'frame-ancestors:';

const leadingSpaceCount = (line: string): number =>
    line.length - line.trimStart().length;

const isSupportedYamlKeyChar = (char: string): boolean =>
    (char >= 'a' && char <= 'z') ||
    (char >= 'A' && char <= 'Z') ||
    (char >= '0' && char <= '9') ||
    char === '_' ||
    char === '-';

const isTopLevelYamlKey = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
        return false;
    }

    if (leadingSpaceCount(line) !== 0 || !trimmed.endsWith(':')) {
        return false;
    }

    const key = trimmed.slice(0, -1);
    if (!key) {
        return false;
    }

    for (const char of key) {
        if (!isSupportedYamlKeyChar(char)) {
            return false;
        }
    }

    return true;
};

const findSectionEnd = (
    lines: readonly string[],
    sectionStart: number
): number => {
    for (let index = sectionStart + 1; index < lines.length; index += 1) {
        if (isTopLevelYamlKey(lines[index])) {
            return index;
        }
    }
    return lines.length;
};

const ensureWebSection = (
    lines: string[]
): { sectionStart: number; changed: boolean } => {
    const existingIndex = lines.findIndex(
        (line) =>
            line.trim() === WEB_SECTION_KEY && leadingSpaceCount(line) === 0
    );
    if (existingIndex >= 0) {
        return { sectionStart: existingIndex, changed: false };
    }

    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
        lines.push('');
    }
    lines.push('web:');
    return { sectionStart: lines.length - 1, changed: true };
};

const ensureWebListEntry = (
    lines: string[],
    webStart: number,
    key: string,
    url: string
): boolean => {
    let changed = false;
    let webEnd = findSectionEnd(lines, webStart);

    let keyIndex = -1;
    for (let index = webStart + 1; index < webEnd; index += 1) {
        if (lines[index].trim() === key) {
            keyIndex = index;
            break;
        }
    }

    if (keyIndex < 0) {
        lines.splice(webEnd, 0, `    ${key}`, `        - '${url}'`);
        return true;
    }

    const keyIndent = leadingSpaceCount(lines[keyIndex]);
    let listEnd = webEnd;
    for (let index = keyIndex + 1; index < webEnd; index += 1) {
        const trimmed = lines[index].trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        if (leadingSpaceCount(lines[index]) <= keyIndent) {
            listEnd = index;
            break;
        }
    }

    const existingList = lines.slice(keyIndex + 1, listEnd);
    const hasExactUrl = existingList.some((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('-')) {
            return false;
        }
        const value = trimmed.slice(1).trim();
        const unquoted =
            (value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))
                ? value.slice(1, -1)
                : value;
        return unquoted === url;
    });

    if (!hasExactUrl) {
        let insertIndex = listEnd;
        while (
            insertIndex > keyIndex + 1 &&
            lines[insertIndex - 1].trim() === ''
        ) {
            insertIndex -= 1;
        }
        lines.splice(insertIndex, 0, `        - '${url}'`);
        changed = true;
    }

    return changed;
};

export const ensureWebLocalUrlInSettings = async (
    settingsPath: string,
    url: string
): Promise<boolean> => {
    const raw = await readFile(settingsPath, 'utf8');
    const normalized = raw.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    const ensured = ensureWebSection(lines);
    let changed = ensured.changed;

    changed =
        ensureWebListEntry(
            lines,
            ensured.sectionStart,
            ALLOWED_ORIGINS_KEY,
            url
        ) || changed;
    changed =
        ensureWebListEntry(
            lines,
            ensured.sectionStart,
            FRAME_ANCESTORS_KEY,
            url
        ) || changed;

    if (!changed) {
        return false;
    }

    let joined = lines.join('\n');
    while (joined.endsWith('\n')) {
        joined = joined.slice(0, -1);
    }
    const next = `${joined}\n`;
    await writeFile(settingsPath, next, 'utf8');
    return true;
};
