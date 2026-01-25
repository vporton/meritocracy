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
                                            <p>{assessment.text}</p>
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
