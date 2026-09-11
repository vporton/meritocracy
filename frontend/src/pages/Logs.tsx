import React, { useState, useEffect } from 'react';
import { logsApi, DBLogEntry, LogsFilter, LogTypes } from '../services/api';
import './Logs.css';
import { Helmet } from 'react-helmet-async';
import Canonical from '../components/Canonical';
import { getFrontendOrigin } from '../config/origins';

type LogUserProfile = NonNullable<DBLogEntry['user']>;

const Logs: React.FC = () => {
  const frontendOrigin = getFrontendOrigin();
  const [logs, setLogs] = useState<DBLogEntry[]>([]);
  const [logTypes, setLogTypes] = useState<LogTypes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogsFilter>({
    type: 'openai', // Default to OpenAI logs only
    limit: 50,
    offset: 0
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [filter]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const typesResponse = await logsApi.getTypes();
      setLogTypes(typesResponse.data.logTypes);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load initial data');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await logsApi.getMy(filter);

      setLogs(response.data.logs);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: keyof LogsFilter, value: any) => {
    setFilter(prev => ({
      ...prev,
      [key]: value,
      offset: 0 // Reset offset when filter changes
    }));
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getLogTypeColor = (type: string) => {
    const colors = {
      openai: '#3b82f6',
      task: '#10b981',
      user: '#f59e0b',
      session: '#8b5cf6'
    };
    return colors[type as keyof typeof colors] || '#6b7280';
  };

  const getStatusColor = (status?: string) => {
    if (!status) return '#6b7280';
    const colors = {
      completed: '#10b981',
      pending: '#f59e0b',
      active: '#10b981',
      expired: '#ef4444',
      banned: '#ef4444',
      cancelled: '#6b7280'
    };
    return colors[status as keyof typeof colors] || '#6b7280';
  };

  const formatUserLabel = (userId?: number, user?: LogUserProfile) => {
    if (!userId && !user?.id) return null;
    const resolvedUserId = userId ?? user?.id;
    const name = user?.name?.trim();
    if (!resolvedUserId) return name || null;
    return name ? `${name} (#${resolvedUserId})` : `#${resolvedUserId}`;
  };

  const shortenAddress = (address: string, leading = 6, trailing = 4) => {
    if (address.length <= leading + trailing + 3) {
      return address;
    }
    return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
  };

  const getLogUser = (log: DBLogEntry): LogUserProfile | undefined => {
    if (log.user) {
      return log.user;
    }

    if (!log.details || typeof log.details !== 'object') {
      return undefined;
    }

    const details = log.details as any;

    if (details.user && typeof details.user === 'object' && typeof details.user.id === 'number') {
      return details.user as LogUserProfile;
    }

    if (typeof details.id === 'number') {
      return {
        id: details.id,
        name: details.name,
        ethereumAddress: details.ethereumAddress,
        solanaAddress: details.solanaAddress,
        bitcoinAddress: details.bitcoinAddress,
        bitcoinCashAddress: details.bitcoinCashAddress,
        polkadotAddress: details.polkadotAddress,
        cosmosAddress: details.cosmosAddress,
        stellarAddress: details.stellarAddress,
        icpAddress: details.icpAddress,
        orcidId: details.orcidId,
        githubHandle: details.githubHandle,
        bitbucketHandle: details.bitbucketHandle,
        gitlabHandle: details.gitlabHandle
      };
    }

    return undefined;
  };

  const getUserAccountLinks = (user: LogUserProfile) => {
    const links: Array<{ key: string; label: string; href: string }> = [];

    if (user.githubHandle) {
      links.push({
        key: `github-${user.githubHandle}`,
        label: `GitHub @${user.githubHandle}`,
        href: `https://github.com/${encodeURIComponent(user.githubHandle)}`
      });
    }
    if (user.gitlabHandle) {
      links.push({
        key: `gitlab-${user.gitlabHandle}`,
        label: `GitLab @${user.gitlabHandle}`,
        href: `https://gitlab.com/${encodeURIComponent(user.gitlabHandle)}`
      });
    }
    if (user.bitbucketHandle) {
      links.push({
        key: `bitbucket-${user.bitbucketHandle}`,
        label: `Bitbucket @${user.bitbucketHandle}`,
        href: `https://bitbucket.org/${encodeURIComponent(user.bitbucketHandle)}`
      });
    }
    if (user.orcidId) {
      links.push({
        key: `orcid-${user.orcidId}`,
        label: `ORCID ${user.orcidId}`,
        href: `https://orcid.org/${encodeURIComponent(user.orcidId)}`
      });
    }
    if (user.ethereumAddress) {
      links.push({
        key: `eth-${user.ethereumAddress}`,
        label: `Ethereum ${shortenAddress(user.ethereumAddress)}`,
        href: `https://etherscan.io/address/${encodeURIComponent(user.ethereumAddress)}`
      });
    }
    if (user.solanaAddress) {
      links.push({
        key: `sol-${user.solanaAddress}`,
        label: `Solana ${shortenAddress(user.solanaAddress, 4, 4)}`,
        href: `https://solscan.io/account/${encodeURIComponent(user.solanaAddress)}`
      });
    }
    if (user.bitcoinAddress) {
      links.push({
        key: `btc-${user.bitcoinAddress}`,
        label: `Bitcoin ${shortenAddress(user.bitcoinAddress, 4, 4)}`,
        href: `https://mempool.space/address/${encodeURIComponent(user.bitcoinAddress)}`
      });
    }
    if (user.bitcoinCashAddress) {
      links.push({
        key: `bch-${user.bitcoinCashAddress}`,
        label: `BCH ${shortenAddress(user.bitcoinCashAddress, 4, 4)}`,
        href: `https://explorer.bitcoin.com/bch/address/${encodeURIComponent(user.bitcoinCashAddress)}`
      });
    }
    if (user.polkadotAddress) {
      links.push({
        key: `dot-${user.polkadotAddress}`,
        label: `Polkadot ${shortenAddress(user.polkadotAddress, 4, 4)}`,
        href: `https://polkadot.subscan.io/account/${encodeURIComponent(user.polkadotAddress)}`
      });
    }
    if (user.cosmosAddress) {
      links.push({
        key: `cosmos-${user.cosmosAddress}`,
        label: `Cosmos ${shortenAddress(user.cosmosAddress, 6, 4)}`,
        href: `https://www.mintscan.io/cosmos/account/${encodeURIComponent(user.cosmosAddress)}`
      });
    }
    if (user.stellarAddress) {
      links.push({
        key: `xlm-${user.stellarAddress}`,
        label: `Stellar ${shortenAddress(user.stellarAddress, 4, 4)}`,
        href: `https://stellar.expert/explorer/public/account/${encodeURIComponent(user.stellarAddress)}`
      });
    }
    if (user.icpAddress) {
      links.push({
        key: `icp-${user.icpAddress}`,
        label: `ICP ${shortenAddress(user.icpAddress)}`,
        href: `https://dashboard.internetcomputer.org/account/${encodeURIComponent(user.icpAddress)}`
      });
    }

    return links;
  };

  const renderLogDetails = (log: DBLogEntry) => {
    return (
      <div className="log-details">
        {/* For OpenAI logs, show request and response sections clearly */}
        {log.type === 'openai' && log.request && log.response ? (
          <>
            <div className="log-details-section request-section">
              <h4>📤 Request to OpenAI</h4>
              <div className="request-meta">
                <span className="timestamp">Sent: {formatTimestamp(log.request.timestamp)}</span>
                <span className="status" style={{ color: getStatusColor(log.request.status) }}>
                  {log.request.status}
                </span>
              </div>
              <pre>{JSON.stringify(log.request.data, null, 2)}</pre>
            </div>

            <div className="log-details-section response-section">
              <h4>📥 Response from OpenAI</h4>
              <div className="response-meta">
                {log.response.timestamp && (
                  <span className="timestamp">Received: {formatTimestamp(log.response.timestamp)}</span>
                )}
                <span className="status" style={{ color: getStatusColor(log.response.status) }}>
                  {log.response.status}
                </span>
              </div>
              {log.response.data ? (
                <pre>{JSON.stringify(log.response.data, null, 2)}</pre>
              ) : (
                <div className="no-response">
                  <p>No response data available</p>
                  {log.response.error && (
                    <p className="error-text">Error: {log.response.error}</p>
                  )}
                </div>
              )}
            </div>

            {/* Additional metadata */}
            <div className="log-details-section">
              <h4>Metadata</h4>
              <pre>{JSON.stringify(log.details, null, 2)}</pre>
            </div>
          </>
        ) : (
          /* For non-OpenAI logs, show the original structure */
          <>
            <div className="log-details-section">
              <h4>Details</h4>
              <pre>{JSON.stringify(log.details, null, 2)}</pre>
            </div>
            {log.error && (
              <div className="log-details-section error">
                <h4>Error</h4>
                <p>{log.error}</p>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  if (loading && logs.length === 0) {
    return (
      <div className="logs-container">
        <div className="loading">Loading logs...</div>
      </div>
    );
  }

  return (
    <div className="logs-container">
      <Helmet>
        <title>Meritocracy App - User Activity Logs</title>
        <meta name="description" content="Meritocracy App - Show user activity logs." />
      </Helmet>
      <Canonical baseUrl={frontendOrigin} />
      <div className="logs-header">
        <h1>Meritocracy App Logs</h1>
        <p>View and filter OpenAI, task, user, and session logs</p>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="filters-section">
        <h3>Filters</h3>
        <div className="filters-grid">
          <div className="filter-group">
            <label>Log Type</label>
            <select
              value={filter.type || 'openai'}
              onChange={(e) => handleFilterChange('type', e.target.value || 'openai')}
            >
              {logTypes && Object.entries(logTypes).map(([key, type]) => (
                <option key={key} value={key}>{type.name}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Start Date</label>
            <input
              type="datetime-local"
              value={filter.startDate || ''}
              onChange={(e) => handleFilterChange('startDate', e.target.value || undefined)}
            />
          </div>

          <div className="filter-group">
            <label>End Date</label>
            <input
              type="datetime-local"
              value={filter.endDate || ''}
              onChange={(e) => handleFilterChange('endDate', e.target.value || undefined)}
            />
          </div>

          <div className="filter-group">
            <label>Limit</label>
            <select
              value={filter.limit || 50}
              onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>

        <div className="filter-actions">
          <button onClick={loadLogs} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button onClick={() => {
            setFilter({ type: 'openai', limit: 50, offset: 0 });
          }}>
            Clear Filters
          </button>
        </div>
      </div>

      {/* Logs List */}
      <div className="logs-section">
        <h3>Logs ({logs.length})</h3>

        {logs.length === 0 ? (
          <div className="no-logs">No logs found matching the current filters.</div>
        ) : (
          <div className="logs-list">
            {logs.map((log) => {
              const logUser = getLogUser(log);
              const userLabel = formatUserLabel(log.userId, logUser);
              const accountLinks = logUser ? getUserAccountLinks(logUser) : [];

              return (
                <div key={log.id} className="log-item">
                <div className="log-header">
                  <div className="log-type" style={{ backgroundColor: getLogTypeColor(log.type) }}>
                    {log.type.toUpperCase()}
                  </div>
                  <div className="log-action">{log.action}</div>
                  <div className="log-timestamp">{formatTimestamp(log.timestamp)}</div>
                  {log.status && (
                    <div
                      className="log-status"
                      style={{ color: getStatusColor(log.status) }}
                    >
                      {log.status}
                    </div>
                  )}
                </div>

                <div className="log-meta">
                  {userLabel && (
                    <span className="log-meta-item">User: {userLabel}</span>
                  )}
                  {accountLinks.length > 0 && (
                    <span className="log-meta-item accounts">
                      Accounts:
                      {' '}
                      {accountLinks.map((accountLink, index) => (
                        <React.Fragment key={accountLink.key}>
                          <a
                            href={accountLink.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="log-account-link"
                          >
                            {accountLink.label}
                          </a>
                          {index < accountLinks.length - 1 ? ', ' : ''}
                        </React.Fragment>
                      ))}
                    </span>
                  )}
                  {log.taskId && (
                    <span className="log-meta-item">Task: {log.taskId}</span>
                  )}
                  {log.error && (
                    <span className="log-meta-item error">Error</span>
                  )}
                </div>

                <details className="log-details-toggle">
                  <summary>View Details</summary>
                  {renderLogDetails(log)}
                </details>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {logs.length > 0 && (
          <div className="pagination">
            <button
              onClick={() => handleFilterChange('offset', Math.max(0, (filter.offset || 0) - (filter.limit || 50)))}
              disabled={!filter.offset || filter.offset <= 0}
            >
              Previous
            </button>
            <span>
              Showing {(filter.offset || 0) + 1} to {Math.min((filter.offset || 0) + (filter.limit || 50), logs.length)}
              {logs.length === (filter.limit || 50) && ' (more available)'}
            </span>
            <button
              onClick={() => handleFilterChange('offset', (filter.offset || 0) + (filter.limit || 50))}
              disabled={logs.length < (filter.limit || 50)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Logs;
