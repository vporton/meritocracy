import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { worldGdpApi } from '../services/api';
import './BanVoting.css';

interface User {
    id: number;
    name: string | null;
    email: string | null;
    shareInGDP: number | null;
    voteCount: number;
    githubHandle?: string;
    bitbucketHandle?: string;
    gitlabHandle?: string;
    orcidId?: string;
}

interface VoteResponse {
    vote: {
        id: number;
        targetUserId: number;
        message: string;
        weekStartDate: string;
    };
    message: string;
}

export default function BanVoting() {
    const { user: authUser } = useAuth();
    const queryClient = useQueryClient();
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [voteMessage, setVoteMessage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const isKycApproved = authUser?.kycVotingStatus === 'APPROVED';

    // Fetch evaluated users and their vote stats
    const { data: users, isLoading, isError } = useQuery<User[]>({
        queryKey: ['ban-voting-users'],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/ban-voting`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch users');
            }
            return response.json();
        }
    });

    // Fetch world GDP for dollar calculation
    const { data: worldGdpData } = useQuery({
        queryKey: ['world-gdp'],
        queryFn: async () => {
            const response = await worldGdpApi.get();
            return response.data;
        }
    });

    const worldGdp = worldGdpData?.data?.worldGdp;

    // Submit vote mutation
    const voteMutation = useMutation({
        mutationFn: async ({ targetUserId, message }: { targetUserId: number, message: string }) => {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/ban-voting/vote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({ targetUserId, message })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit vote');
            }
            return data as VoteResponse;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ban-voting-users'] });
            setSuccess('Vote submitted successfully!');
            setSelectedUser(null);
            setVoteMessage('');
            setTimeout(() => setSuccess(null), 3000);
        },
        onError: (err: Error) => {
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        }
    });

    const handleVoteClick = (user: User) => {
        if (!isKycApproved) {
            setError('You must pass KYC Level 1 to participate in ban voting.');
            return;
        }
        setSelectedUser(user);
        setVoteMessage('');
        setError(null);
    };

    const handleSubmitVote = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedUser && voteMessage.trim()) {
            voteMutation.mutate({ targetUserId: selectedUser.id, message: voteMessage });
        }
    };

    return (
        <div className="ban-voting-page">
            <div className="container">
                <header className="page-header">
                    <h1>Ban Voting System</h1>
                    <p className="subtitle">Vote to ban users who violate community standards. Weekly reset.</p>
                </header>

                {!isKycApproved && authUser && (
                    <div className="kyc-warning-banner">
                        <p><strong>Verification Required:</strong> You need to pass KYC Level 1 (Voting KYC) to participate in ban voting.
                            Please visit the <a href="/connect">Connect page</a> to initiate verification.</p>
                    </div>
                )}

                {!authUser && (
                    <div className="kyc-warning-banner">
                        <p>Please <a href="/connect">log in</a> to participate in ban voting.</p>
                    </div>
                )}

                {error && <div className="alert error">{error}</div>}
                {success && <div className="alert success">{success}</div>}

                <div className="users-grid">
                    {isLoading ? (
                        <div className="loading">Loading evaluated users...</div>
                    ) : isError ? (
                        <div className="error-message">Failed to load users. Please try again later.</div>
                    ) : users?.length === 0 ? (
                        <div className="empty-state">No evaluated users found or you may need to log in.</div>
                    ) : (
                        users?.map((user) => (
                            <div key={user.id} className="user-card">
                                <div className="user-info">
                                    <h3>{user.name || `User #${user.id}`}</h3>
                                    <div className="user-stats">
                                        <span className="stat">
                                            <span className="label">GDP Share:</span>
                                            <span className="value">
                                                {user.shareInGDP
                                                    ? `${(user.shareInGDP * 100).toExponential(4)}%${worldGdp ? ` ($${(user.shareInGDP * worldGdp).toLocaleString()})` : ''}`
                                                    : 'N/A'
                                                }
                                            </span>
                                        </span>
                                        {user.email && (
                                            <span className="stat">
                                                <span className="label">Email:</span>
                                                <span className="value">{user.email}</span>
                                            </span>
                                        )}
                                        <span className={`stat vote-stat ${user.voteCount > 0 ? 'has-votes' : ''}`}>
                                            <span className="label">Votes this week:</span>
                                            <span className="value">{user.voteCount}</span>
                                        </span>
                                    </div>
                                    <div className="user-profiles">
                                        {user.githubHandle && (
                                            <a href={`https://github.com/${user.githubHandle}`} target="_blank" rel="noopener noreferrer" className="profile-link github" title="GitHub Profile">
                                                <img src="/github-mark.svg" alt="GitHub" className="profile-icon" />
                                                {user.githubHandle}
                                            </a>
                                        )}
                                        {user.gitlabHandle && (
                                            <a href={`https://gitlab.com/${user.gitlabHandle}`} target="_blank" rel="noopener noreferrer" className="profile-link gitlab" title="GitLab Profile">
                                                <span className="profile-icon">🦊</span>
                                                {user.gitlabHandle}
                                            </a>
                                        )}
                                        {user.bitbucketHandle && (
                                            <a href={`https://bitbucket.org/${user.bitbucketHandle}`} target="_blank" rel="noopener noreferrer" className="profile-link bitbucket" title="Bitbucket Profile">
                                                <span className="profile-icon">🟦</span>
                                                {user.bitbucketHandle}
                                            </a>
                                        )}
                                        {user.orcidId && (
                                            <a href={`https://orcid.org/${user.orcidId}`} target="_blank" rel="noopener noreferrer" className="profile-link orcid" title="ORCID Profile">
                                                <span className="profile-icon">🆔</span>
                                                {user.orcidId}
                                            </a>
                                        )}
                                    </div>
                                </div>
                                <button
                                    className={`vote-button ${!isKycApproved ? 'disabled' : ''}`}
                                    onClick={() => handleVoteClick(user)}
                                    disabled={!isKycApproved}
                                    title={!isKycApproved ? 'KYC Level 1 required' : ''}
                                >
                                    {user.voteCount === 0 ? 'Start Ban Vote' : 'Join Ban Vote'}
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {selectedUser && (
                    <div className="modal-overlay" onClick={() => setSelectedUser(null)}>
                        <div className="modal-content" onClick={e => e.stopPropagation()}>
                            <button className="close-button" onClick={() => setSelectedUser(null)}>×</button>
                            <h2>
                                {selectedUser.voteCount === 0 ? 'Start Ban Vote: ' : 'Join Ban Vote: '}
                                {selectedUser.name || `User #${selectedUser.id}`}
                            </h2>
                            <form onSubmit={handleSubmitVote}>
                                <div className="form-group">
                                    <label htmlFor="vote-message">
                                        Reason for ban (Message)
                                        {selectedUser.voteCount === 0 ? <span className="required-star">*</span> : <span className="optional-text"> (Optional)</span>}:
                                    </label>
                                    <textarea
                                        id="vote-message"
                                        value={voteMessage}
                                        onChange={(e) => setVoteMessage(e.target.value)}
                                        placeholder={selectedUser.voteCount === 0
                                            ? "Enter your reason for voting to ban this user..."
                                            : "Optionally add your reason..."}
                                        required={selectedUser.voteCount === 0}
                                        rows={4}
                                    />
                                    <p className="help-text">
                                        Note: Only one message per pair of voter and target is allowed per week.
                                        Only Voting KYC approved users can vote.
                                        {selectedUser.voteCount === 0 && " As the first voter, a message is required to open the voting."}
                                    </p>
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="cancel-button" onClick={() => setSelectedUser(null)}>
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="submit-button"
                                        disabled={voteMutation.isPending || (selectedUser.voteCount === 0 && !voteMessage.trim())}
                                    >
                                        {voteMutation.isPending ? 'Submitting...' : 'Submit Vote'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
