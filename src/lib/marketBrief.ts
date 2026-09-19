export function summarizeMarketBrief(content: string, maxLength = 220): string {
    const plainText = content
        .replace(/^#{1,6}\s+.+$/gm, "")
        .replace(/^[-*]\s+/gm, "")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (plainText.length <= maxLength) return plainText;

    const clipped = plainText.slice(0, Math.max(0, maxLength - 1));
    const lastSpace = clipped.lastIndexOf(" ");
    return `${clipped.slice(0, lastSpace > maxLength * 0.6 ? lastSpace : undefined).trim()}...`;
}

export function parseMarketBriefSections(content: string): Array<{ title: string; body: string }> {
    const sections: Array<{ title: string; body: string }> = [];
    let title = "Brief";
    let lines: string[] = [];

    const commit = () => {
        const body = lines.join("\n").trim();
        if (body) sections.push({ title, body });
        lines = [];
    };

    for (const line of content.split(/\r?\n/)) {
        const heading = line.match(/^#{1,6}\s+(.+)$/);
        if (heading) {
            commit();
            title = heading[1].trim();
        } else {
            lines.push(line);
        }
    }
    commit();

    return sections;
}
