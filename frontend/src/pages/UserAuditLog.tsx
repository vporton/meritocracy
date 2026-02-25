import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import './UserAuditLog.css';
import { markdownToHtml } from '../utils/markdown';
import Canonical from '../components/Canonical';
import { User } from '../services/api';

interface WorthValue {
    key: 'overall' | 'scientist' | 'fossDev' | 'scienceMarketer';
    label: string;
    fractionOfGDP: number;
    usd: number | null;
}

interface Assessment {
    text: string;
    sources: string[];
    timestamp: string;
    worthValues?: WorthValue[];
    isPending?: boolean;
    isError?: boolean;
}

interface AssessmentsResponse {
    items: Assessment[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}

export default function UserAuditLog() {
    const { userId } = useParams<{ userId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const pageParam = Number.parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

    const { data, isLoading, isError } = useQuery<AssessmentsResponse>({
        queryKey: ['user-assessments', userId, page],
        queryFn: async () => {
            const response = await fetch(
                `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/ban-voting/${userId}/assessments?page=${page}&pageSize=3`
            );
            if (!response.ok) {
                throw new Error('Failed to fetch assessments');
            }
            return response.json();
        },
        enabled: !!userId
    });

    const { data: userProfile } = useQuery<User>({
        queryKey: ['user-profile', userId],
        queryFn: async () => {
            const response = await fetch(
                `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/users/${userId}`
            );
            if (!response.ok) {
                throw new Error('Failed to fetch user profile');
            }
            return response.json();
        },
        enabled: !!userId
    });

    const assessments = data?.items ?? [];
    const pagination = data?.pagination;

    const displayName = userProfile?.name?.trim() || (userId ? `User #${userId}` : 'Unknown user');

    const formatFraction = (value: number) =>
        Math.abs(value) < 0.0001 ? value.toExponential(4) : value.toLocaleString(undefined, { maximumSignificantDigits: 6 });

    const formatUsd = (value: number | null) => {
        if (value === null) return 'N/A';
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 2
        }).format(value);
    };

    const shortenAddress = (address: string, leading = 6, trailing = 4) => {
        if (address.length <= leading + trailing + 3) return address;
        return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
    };

    const profileLinks: Array<{ key: string; label: string; href: string }> = [];
    if (userProfile?.githubHandle) {
        profileLinks.push({
            key: `github-${userProfile.githubHandle}`,
            label: `GitHub @${userProfile.githubHandle}`,
            href: `https://github.com/${encodeURIComponent(userProfile.githubHandle)}`
        });
    }
    if (userProfile?.gitlabHandle) {
        profileLinks.push({
            key: `gitlab-${userProfile.gitlabHandle}`,
            label: `GitLab @${userProfile.gitlabHandle}`,
            href: `https://gitlab.com/${encodeURIComponent(userProfile.gitlabHandle)}`
        });
    }
    if (userProfile?.bitbucketHandle) {
        profileLinks.push({
            key: `bitbucket-${userProfile.bitbucketHandle}`,
            label: `Bitbucket @${userProfile.bitbucketHandle}`,
            href: `https://bitbucket.org/${encodeURIComponent(userProfile.bitbucketHandle)}`
        });
    }
    if (userProfile?.orcidId) {
        profileLinks.push({
            key: `orcid-${userProfile.orcidId}`,
            label: `ORCID ${userProfile.orcidId}`,
            href: `https://orcid.org/${encodeURIComponent(userProfile.orcidId)}`
        });
    }
    if (userProfile?.ethereumAddress) {
        profileLinks.push({
            key: `eth-${userProfile.ethereumAddress}`,
            label: `Ethereum ${shortenAddress(userProfile.ethereumAddress)}`,
            href: `https://etherscan.io/address/${encodeURIComponent(userProfile.ethereumAddress)}`
        });
    }
    if (userProfile?.solanaAddress) {
        profileLinks.push({
            key: `sol-${userProfile.solanaAddress}`,
            label: `Solana ${shortenAddress(userProfile.solanaAddress, 4, 4)}`,
            href: `https://solscan.io/account/${encodeURIComponent(userProfile.solanaAddress)}`
        });
    }
    if (userProfile?.bitcoinAddress) {
        profileLinks.push({
            key: `btc-${userProfile.bitcoinAddress}`,
            label: `Bitcoin ${shortenAddress(userProfile.bitcoinAddress, 4, 4)}`,
            href: `https://mempool.space/address/${encodeURIComponent(userProfile.bitcoinAddress)}`
        });
    }
    if (userProfile?.bitcoinCashAddress) {
        profileLinks.push({
            key: `bch-${userProfile.bitcoinCashAddress}`,
            label: `BCH ${shortenAddress(userProfile.bitcoinCashAddress, 4, 4)}`,
            href: `https://explorer.bitcoin.com/bch/address/${encodeURIComponent(userProfile.bitcoinCashAddress)}`
        });
    }
    if (userProfile?.polkadotAddress) {
        profileLinks.push({
            key: `dot-${userProfile.polkadotAddress}`,
            label: `Polkadot ${shortenAddress(userProfile.polkadotAddress, 4, 4)}`,
            href: `https://polkadot.subscan.io/account/${encodeURIComponent(userProfile.polkadotAddress)}`
        });
    }
    if (userProfile?.cosmosAddress) {
        profileLinks.push({
            key: `cosmos-${userProfile.cosmosAddress}`,
            label: `Cosmos ${shortenAddress(userProfile.cosmosAddress, 6, 4)}`,
            href: `https://www.mintscan.io/cosmos/account/${encodeURIComponent(userProfile.cosmosAddress)}`
        });
    }
    if (userProfile?.stellarAddress) {
        profileLinks.push({
            key: `xlm-${userProfile.stellarAddress}`,
            label: `Stellar ${shortenAddress(userProfile.stellarAddress, 4, 4)}`,
            href: `https://stellar.expert/explorer/public/account/${encodeURIComponent(userProfile.stellarAddress)}`
        });
    }
    if (userProfile?.icpAddress) {
        profileLinks.push({
            key: `icp-${userProfile.icpAddress}`,
            label: `ICP ${shortenAddress(userProfile.icpAddress)}`,
            href: `https://dashboard.internetcomputer.org/account/${encodeURIComponent(userProfile.icpAddress)}`
        });
    }

    return (
        <div className="user-audit-log-page">
            <Helmet>
                <title>Recommended Salary for User "{displayName}" - Meritocracy</title>
            </Helmet>
            <Canonical baseUrl="https://merit.science-dao.org" />
            <div className="container">
                <header className="page-header">
                    <Link to="/ban-voting" className="back-link"><span data-nosnippet="data-nosnippet">← Back to Voting</span></Link>
                    <h1>User Worth Research Audit Log</h1>
                    <p className="subtitle">AI rationales and sources for Recommended Salary of user {displayName}</p>
                    {profileLinks.length > 0 && (
                        <p className="profile-links" data-nosnippet="data-nosnippet">
                            {profileLinks.map((profileLink, index) => (
                                <span key={profileLink.key}>
                                    <a href={profileLink.href} target="_blank" rel="noopener noreferrer">
                                        {profileLink.label}
                                    </a>
                                    {index < profileLinks.length - 1 ? ' • ' : ''}
                                </span>
                            ))}
                        </p>
                    )}
                </header>

                <div className="assessments-list">
                    {isLoading ? (
                        <div className="loading">Loading research history...</div>
                    ) : isError ? (
                        <div className="error-message">Failed to load research data.</div>
                    ) : assessments.length === 0 ? (
                        <div className="empty-state">
                            <p>No research data found for this user.</p>
                        </div>
                    ) : (
                        assessments.map((assessment, index) => {
                            const status = assessment.isPending ? 'pending' : assessment.isError ? 'error' : 'completed';
                            const badgeLabel = assessment.isPending ? 'Pending AI Analysis' : assessment.isError ? 'Research Error' : 'Recommended Salary Assessment';

                            return (
                                <section key={index} className={`assessment-card status-${status}`}>
                                    <div className="assessment-header">
                                        <span className="assessment-date" data-nosnippet="data-nosnippet">
                                            {new Date(assessment.timestamp).toLocaleString()}
                                        </span>
                                        <span className={`assessment-label badge-${status}`}>
                                            {badgeLabel}
                                        </span>
                                    </div>
                                    <div className="assessment-content">
                                        {assessment.worthValues && assessment.worthValues.length > 0 && (
                                            <section className="worth-section">
                                                <h3>Assigned Worth</h3>
                                                <div data-nosnippet="data-nosnippet">
                                                    <ul>
                                                        {assessment.worthValues.map((worth) => (
                                                            <li key={worth.key}>
                                                                <strong>{worth.label}:</strong>{' '}
                                                                <span>{formatFraction(worth.fractionOfGDP)} of GDP</span>{' '}
                                                                (<span>{formatUsd(worth.usd)}</span>)
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </section>
                                        )}
                                        <div className={`rationale-text ${status}`}>
                                            <h3>Rationale</h3>
                                            <div
                                                className="markdown-content"
                                                dangerouslySetInnerHTML={{ __html: markdownToHtml(assessment.text) }}
                                            />
                                        </div>
                                        {assessment.sources && assessment.sources.length > 0 && (
                                            <section className="sources-section">
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
                                            </section>
                                        )}
                                    </div>
                                </section>
                            );
                        })
                    )}
                </div>
                {pagination && pagination.totalPages > 1 && (
                    <div className="pagination-controls">
                        <button
                            type="button"
                            onClick={() => {
                                const nextPage = Math.max(page - 1, 1);
                                setSearchParams(nextPage > 1 ? { page: String(nextPage) } : {});
                            }}
                            disabled={pagination.page <= 1}
                        >
                            Previous
                        </button>
                        <span>
                            Page {pagination.page} of {pagination.totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                const nextPage = Math.min(page + 1, pagination.totalPages);
                                setSearchParams(nextPage > 1 ? { page: String(nextPage) } : {});
                            }}
                            disabled={pagination.page >= pagination.totalPages}
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
