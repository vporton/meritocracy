function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderMarkdownInline(text: string): string {
    return text
        .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(markdown: string): string {
    const lines = escapeHtml(markdown).split('\n');
    const blocks: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();

        if (!line) {
            i += 1;
            continue;
        }

        if (line.startsWith('### ')) {
            blocks.push(`<h3>${renderMarkdownInline(line.slice(4).trim())}</h3>`);
            i += 1;
            continue;
        }

        if (line.startsWith('## ')) {
            blocks.push(`<h2>${renderMarkdownInline(line.slice(3).trim())}</h2>`);
            i += 1;
            continue;
        }

        if (line.startsWith('# ')) {
            blocks.push(`<h1>${renderMarkdownInline(line.slice(2).trim())}</h1>`);
            i += 1;
            continue;
        }

        if (line.startsWith('```')) {
            const codeLines: string[] = [];
            i += 1;
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                codeLines.push(lines[i]);
                i += 1;
            }
            blocks.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
            i += 1;
            continue;
        }

        const unorderedMatch = line.match(/^[-*]\s+(.+)/);
        if (unorderedMatch) {
            const items: string[] = [];
            while (i < lines.length) {
                const entry = lines[i].trim().match(/^[-*]\s+(.+)/);
                if (!entry) {
                    break;
                }
                items.push(`<li>${renderMarkdownInline(entry[1])}</li>`);
                i += 1;
            }
            blocks.push(`<ul>${items.join('')}</ul>`);
            continue;
        }

        const orderedMatch = line.match(/^\d+\.\s+(.+)/);
        if (orderedMatch) {
            const items: string[] = [];
            while (i < lines.length) {
                const entry = lines[i].trim().match(/^\d+\.\s+(.+)/);
                if (!entry) {
                    break;
                }
                items.push(`<li>${renderMarkdownInline(entry[1])}</li>`);
                i += 1;
            }
            blocks.push(`<ol>${items.join('')}</ol>`);
            continue;
        }

        const paragraph: string[] = [];
        while (i < lines.length && lines[i].trim()) {
            paragraph.push(lines[i]);
            i += 1;
        }
        blocks.push(`<p>${renderMarkdownInline(paragraph.join(' '))}</p>`);
    }

    return blocks.join('');
}
