/**
 * Small helpers shared by the modules: a safe file name and saving a file.
 */

/** The name of a file when the document has none. */
const DEFAULT_FILE_NAME = 'document';
/** How long the address of a saved file stays valid, in milliseconds. */
const DOWNLOAD_URL_LIFETIME = 4000;

/**
 * Returns a name that can be used as a file name.
 * @param {*} name - the document's name.
 * @returns {string} the trimmed name, each run of \ / : * ? " < > | written as "-"; "document" when empty.
 */
export function getSafeName(name) {
    return (String(name || '').trim() || DEFAULT_FILE_NAME).replace(/[\\/:*?"<>|]+/g, '-');
}

/**
 * Saves text or a Blob as a file through the browser's download.
 * @param {string|Uint8Array|Blob} data - the content.
 * @param {string} name - the file name.
 * @param {string} [type] - the media type when data is not a Blob; text, XML, JSON and LaTeX get charset=utf-8.
 * @returns {void}
 */
export function saveFile(data, name, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type + (/^text|xml|json|x-tex/.test(type) ? ';charset=utf-8' : '') });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), DOWNLOAD_URL_LIFETIME);
}
