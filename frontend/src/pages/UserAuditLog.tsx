import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import './UserAuditLog.css';

interface Assessment {
    text: string;
    sources: string[];
    timestamp: string;
    isPending?: boolean;
    isError?: boolean;
}

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

function markdownToHtml(markdown: string): string {
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

export default function UserAuditLog() {
    const { userId } = useParams<{ userId: string }>();

    const { data: assessments, isLoading, isError } = useQuery<Assessment[]>({
        queryKey: ['user-assessments', userId],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/ban-voting/${userId}/assessments`);
            if (!response.ok) {
                throw new Error('Failed to fetch assessments');
            }
            return response.json();
        },
        enabled: !!userId
    });

    return (
        <div className="user-audit-log-page">
            <Helmet>
                <title>User Audit Log - Meritocracy</title>
            </Helmet>
            <div className="container">
                <header className="page-header">
                    <Link to="/ban-voting" className="back-link">← Back to Voting</Link>
                    <h1>User Research Audit Log</h1>
                    <p className="subtitle">AI rationales and sources for User #{userId}</p>
                </header>

                <div className="assessments-list">
                    {isLoading ? (
                        <div className="loading">Loading research history...</div>
                    ) : isError ? (
                        <div className="error-message">Failed to load research data.</div>
                    ) : assessments?.length === 0 ? (
                        <div className="empty-state">
                            <p>No research data found for this user.</p>
                        </div>
                    ) : (
                        assessments?.map((assessment, index) => {
                            const status = assessment.isPending ? 'pending' : assessment.isError ? 'error' : 'completed';
                            const badgeLabel = assessment.isPending ? 'Pending AI Analysis' : assessment.isError ? 'Research Error' : 'AI Research Assessment';

                            return (
                                <div key={index} className={`assessment-card status-${status}`}>
                                    <div className="assessment-header">
                                        <span className="assessment-date">
                                            {new Date(assessment.timestamp).toLocaleString()}
                                        </span>
                                        <span className={`assessment-label badge-${status}`}>
                                            {badgeLabel}
                                        </span>
                                    </div>
                                    <div className="assessment-content">
                                        <div className={`rationale-text ${status}`}>
                                            <h3>Rationale</h3>
                                            <div
                                                className="markdown-content"
                                                dangerouslySetInnerHTML={{ __html: markdownToHtml(assessment.text) }}
                                            />
                                        </div>
                                        {assessment.sources && assessment.sources.length > 0 && (
                                            <div className="sources-section">
                                                <h3>Research Sources</h3>
                                                <ul>
                                                    {assessment.sources.map((source, sIndex) => (
                                                        <li key={sIndex}>
                                                            <a href={source} target="_blank" rel="noopener noreferrer">
                                                                {source}
                                                            </a>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
