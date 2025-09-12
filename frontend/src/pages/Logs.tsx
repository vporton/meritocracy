import React, { useState, useEffect } from 'react';
import { logsApi, DBLogEntry, LogsFilter, LogStats, LogTypes } from '../services/api';
import './Logs.css';

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<DBLogEntry[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [logTypes, setLogTypes] = useState<LogTypes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogsFilter>({
    type: 'openai', // Default to OpenAI logs only
    limit: 50,
    offset: 0
  });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showMyLogs, setShowMyLogs] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [filter, selectedUserId, showMyLogs]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [statsResponse, typesResponse] = await Promise.all([
        logsApi.getStats(),
        logsApi.getTypes()
      ]);
      
      setStats(statsResponse.data.stats);
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
      
      let response;
      if (showMyLogs) {
        response = await logsApi.getMy(filter);
      } else if (selectedUserId) {
        response = await logsApi.getUser(selectedUserId, filter);
      } else {
        response = await logsApi.getAll(filter);
      }
      
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

  const handleUserIdChange = (userId: string) => {
    const id = userId ? parseInt(userId) : null;
    setSelectedUserId(id);
    setShowMyLogs(false);
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

  const renderLogDetails = (log: DBLogEntry) => {
    return (
      <div className="log-details">
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
      <div className="logs-header">
        <h1>OpenAI API Logs</h1>
        <p>View and filter OpenAI API request and response logs</p>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Stats Overview */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Logs</h3>
            <p className="stat-number">{stats.totalLogs.toLocaleString()}</p>
          </div>
          <div className="stat-card">
            <h3>Recent Activity</h3>
            <p className="stat-number">{stats.recentActivity.toLocaleString()}</p>
            <p className="stat-label">Last 24 hours</p>
          </div>
          {Object.entries(stats.logsByType).map(([type, count]) => (
            <div key={type} className="stat-card">
              <h3>{logTypes?.[type]?.name || type}</h3>
              <p className="stat-number">{count.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="filters-section">
        <h3>Filters</h3>
        <div className="filters-grid">
          <div className="filter-group">
            <label>View Mode</label>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  name="viewMode"
                  checked={!showMyLogs && !selectedUserId}
                  onChange={() => {
                    setShowMyLogs(false);
                    setSelectedUserId(null);
                  }}
                />
                All Logs
              </label>
              <label>
                <input
                  type="radio"
                  name="viewMode"
                  checked={showMyLogs}
                  onChange={() => setShowMyLogs(true)}
                />
                My Logs
              </label>
              <label>
                <input
                  type="radio"
                  name="viewMode"
                  checked={!showMyLogs && selectedUserId !== null}
                  onChange={() => setSelectedUserId(0)}
                />
                User Logs
              </label>
            </div>
          </div>

          {!showMyLogs && (
            <div className="filter-group">
              <label>User ID</label>
              <input
                type="number"
                value={selectedUserId || ''}
                onChange={(e) => handleUserIdChange(e.target.value)}
                placeholder="Enter user ID"
                disabled={showMyLogs}
              />
            </div>
          )}

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
            setSelectedUserId(null);
            setShowMyLogs(false);
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
            {logs.map((log) => (
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
                  {log.userId && (
                    <span className="log-meta-item">User: {log.userId}</span>
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
            ))}
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
              Showing {filter.offset || 0 + 1} to {Math.min((filter.offset || 0) + (filter.limit || 50), logs.length)} 
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
