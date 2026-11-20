/**
 * My documents: several documents kept in this browser (localStorage), no server.
 * yamleditor.files holds the list of entries, yamleditor.file.<id> the code of each document.
 * The editor works on one of them at a time; files-dialog.js shows the list.
 *
 * Documents from a page around the editor are kept in memory only: they are in the list like
 * the others but never written to the browser's storage, and are gone when the editor closes.
 * An entry of such a document found in storage is removed with its code when this module
 * loads, before anything reads the list.
 *
 * The review test imports this file with the ?v= the editor's own modules import it
 * with (so it gets the same instance) and calls store.list(), store.create() and
 * store.remove(), and the sync test calls store.code() through window.yamlEditor:
 * these four names stay.
 */

/** The localStorage key of the list; the dialog follows its changes from other tabs. */
export const LIST = 'yamleditor.files';
const FILE = 'yamleditor.file.';
const DEFAULT_NAME = 'Document';
const MAX_NAME_LENGTH = 80;
const ID_RADIX = 36;
const ID_RANDOM_START = 2;
const ID_RANDOM_END = 6;

/**
 * The entry of a document in the list.
 * @typedef {object} FileEntry
 * @property {string} id - the document's id.
 * @property {string} name - its name.
 * @property {number} created - when it was made (milliseconds since 1970).
 * @property {number} updated - when its code last changed.
 * @property {number} [size] - the size of its code in bytes (UTF-8).
 * @property {object} [hook] - its own webhook.
 * @property {string} [schema] - the id of the document holding its JSON Schema.
 * @property {string} [page] - the origin of the page (or server) it came from.
 * @property {boolean} [temp] - true for a document kept in memory only.
 */

/** Documents kept in memory only, by id: { meta: FileEntry, code: string }. */
const memoryDocuments = new Map();

export const store = {
    /**
     * Returns the entries of the documents stored in this browser.
     * @returns {FileEntry[]} the entries, empty when the storage is blocked.
     */
    getSavedEntries() {
        try {
            const entries = JSON.parse(localStorage.getItem(LIST) || '[]');
            return Array.isArray(entries) ? entries.filter(entry => entry && entry.id && !entry.temp) : [];
        } catch (e) { return []; }
    },

    /**
     * Returns the entries of all documents, the stored ones and those kept in memory.
     * @returns {FileEntry[]} the entries.
     */
    list() {
        return [...this.getSavedEntries(), ...[...memoryDocuments.values()].map(memoryDocument => memoryDocument.meta)];
    },

    /**
     * Returns the entries of all documents, the most recently changed first.
     * @returns {FileEntry[]} the entries.
     */
    getSortedEntries() {
        return this.list().sort((a, b) => b.updated - a.updated);
    },

    /**
     * Returns the entry of a document.
     * @param {string} id - the document's id.
     * @returns {FileEntry|null} the entry, null when there is none.
     */
    getEntry(id) {
        return this.list().find(entry => entry.id === id) || null;
    },

    /**
     * Tells whether a document is kept in memory only.
     * @param {string} id - the document's id.
     * @returns {boolean} true for a document from a page around the editor.
     */
    isInMemory(id) {
        return memoryDocuments.has(id);
    },

    /**
     * Returns the code of a document.
     * @param {string} id - the document's id.
     * @returns {string|null} the code, null when there is none or the storage is blocked.
     */
    code(id) {
        if (memoryDocuments.has(id)) return memoryDocuments.get(id).code;
        try { return localStorage.getItem(FILE + id); } catch (e) { return null; }
    },

    /**
     * Writes the code and/or the name of a document; adds the document to the list when it is
     * missing (deleted in another tab meanwhile).
     * @param {string} id - the document's id.
     * @param {object} fields - what to write.
     * @param {string} [fields.name] - the new name.
     * @param {string} [fields.code] - the new code.
     * @returns {void}
     * @throws {DOMException} when the storage is full.
     */
    save(id, { name, code }) {
        const memoryDocument = memoryDocuments.get(id);
        if (memoryDocument) {
            if (code != null) { memoryDocument.code = code; memoryDocument.meta.updated = Date.now(); memoryDocument.meta.size = new Blob([code]).size; }
            if (name) memoryDocument.meta.name = name;
            return;
        }
        const entries = this.getSavedEntries();
        let entry = entries.find(item => item.id === id);
        if (!entry) { entry = { id, name: name || DEFAULT_NAME, created: Date.now(), updated: Date.now() }; entries.push(entry); }
        if (code != null) { localStorage.setItem(FILE + id, code); entry.updated = Date.now(); entry.size = new Blob([code]).size; }
        if (name) entry.name = name;
        localStorage.setItem(LIST, JSON.stringify(entries));
    },

    /**
     * Sets other fields of a document's entry (its own webhook, its schema …); null or
     * undefined removes a field.
     * @param {string} id - the document's id.
     * @param {object} fields - the fields to set.
     * @returns {void}
     * @throws {DOMException} when the storage is full.
     */
    setEntryFields(id, fields) {
        const memoryDocument = memoryDocuments.get(id);
        const entries = memoryDocument ? null : this.getSavedEntries();
        const entry = memoryDocument ? memoryDocument.meta : entries.find(item => item.id === id);
        if (!entry) return;
        for (const [key, value] of Object.entries(fields)) { if (value == null) delete entry[key]; else entry[key] = value; }
        if (entries) localStorage.setItem(LIST, JSON.stringify(entries));
    },

    /**
     * Creates a document with a free name.
     * @param {string} name - the name it should get.
     * @param {string} code - its code.
     * @param {boolean} [inMemory] - true to keep it in memory only (a page's document), never stored.
     * @returns {string} the new document's id.
     * @throws {DOMException} when the storage is full.
     */
    create(name, code, inMemory = false) {
        const id = Date.now().toString(ID_RADIX) + Math.random().toString(ID_RADIX).slice(ID_RANDOM_START, ID_RANDOM_END);
        if (inMemory) {
            const now = Date.now();
            memoryDocuments.set(id, { meta: { id, name: this.getUniqueName(name), created: now, updated: now, size: new Blob([code || '']).size, temp: true }, code: code || '' });
        } else this.save(id, { name: this.getUniqueName(name), code });
        return id;
    },

    /**
     * Removes a document and its code.
     * @param {string} id - the document's id.
     * @returns {void}
     */
    remove(id) {
        if (memoryDocuments.delete(id)) return;
        try {
            localStorage.removeItem(FILE + id);
            localStorage.setItem(LIST, JSON.stringify(this.getSavedEntries().filter(entry => entry.id !== id)));
        } catch (e) { /* storage blocked */ }
    },

    /**
     * Returns the document with a name, ignoring case and spaces around it.
     * @param {string} name - the name.
     * @returns {FileEntry|null} its entry, null when there is none.
     */
    findByName(name) {
        const wanted = String(name || '').trim().toLowerCase();
        return wanted ? this.list().find(entry => entry.name.trim().toLowerCase() === wanted) || null : null;
    },

    /**
     * Returns a name no other document has: "House", or "House 2", "House 3" … when it is taken.
     * @param {string} name - the name wanted.
     * @param {string} [except] - the id of a document whose name does not count.
     * @returns {string} the free name.
     */
    getUniqueName(name, except) {
        const base = String(name || DEFAULT_NAME).trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_NAME;
        const taken = new Set(this.list().filter(entry => entry.id !== except).map(entry => entry.name.trim().toLowerCase()));
        if (!taken.has(base.toLowerCase())) return base;
        const stem = base.replace(/\s+\d+$/, '');
        for (let number = 2; ; number++) if (!taken.has(`${stem} ${number}`.toLowerCase())) return `${stem} ${number}`;
    },
};

removeStoredMemoryEntries();

/**
 * Removes entries of documents kept in memory from the storage, with their code: such an entry
 * never belongs there.
 * @returns {void}
 */
function removeStoredMemoryEntries() {
    try {
        const entries = JSON.parse(localStorage.getItem(LIST) || '[]');
        if (!Array.isArray(entries) || !entries.some(entry => entry && entry.temp)) return;
        for (const entry of entries) {
            if (entry && entry.temp && entry.id) localStorage.removeItem(FILE + entry.id);
        }
        localStorage.setItem(LIST, JSON.stringify(entries.filter(entry => entry && !entry.temp)));
    } catch (e) { /* storage blocked */ }
}
