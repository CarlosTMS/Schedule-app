import associateEmailDirectory from '../data/associateEmailDirectory.json';

const normalizeAssociateName = (value: string): string =>
    value
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

const directory = new Map<string, string>(
    (associateEmailDirectory as { name: string; email: string }[]).map(entry => [
        normalizeAssociateName(entry.name),
        entry.email.trim().toLowerCase(),
    ])
);

export const getAssociateEmail = (name: string | undefined, fallback?: string): string => {
    const normalizedFallback = fallback?.trim() ?? '';
    if (normalizedFallback) return normalizedFallback;
    if (!name) return '';
    return directory.get(normalizeAssociateName(name)) ?? '';
};

