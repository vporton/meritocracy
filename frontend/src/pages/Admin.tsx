import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { adminApi } from '../services/api';
import './Admin.css';

const Admin: React.FC = () => {
    const [password, setPassword] = useState(localStorage.getItem('adminPassword') || '');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [status, setStatus] = useState<{ gasDistributionEnabled: boolean; cronStatus: any } | null>(null);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [triggering, setTriggering] = useState(false);
    const [reassessing, setReassessing] = useState(false);

    useEffect(() => {
        if (password) {
            checkStatus();
        }
    }, []);

    const checkStatus = async () => {
        setLoading(true);
        try {
            const response = await adminApi.getStatus(password);
            setStatus(response.data);
            setIsAuthenticated(true);
            localStorage.setItem('adminPassword', password);
        } catch (error) {
            setIsAuthenticated(false);
            setMessage({ text: 'Invalid password or connection error', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        checkStatus();
    };

    const toggleDistribution = async () => {
        if (!status) return;
        setLoading(true);
        try {
            const newStatus = !status.gasDistributionEnabled;
            const response = await adminApi.toggleDistribution(password, newStatus);
            setStatus(prev => prev ? { ...prev, gasDistributionEnabled: response.data.enabled } : null);
            setMessage({ text: response.data.message, type: 'success' });
        } catch (error) {
            setMessage({ text: 'Failed to update distribution status', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const triggerDistribution = async () => {
        setTriggering(true);
        setMessage(null);
        try {
            const response = await adminApi.triggerDistribution(password);
            setMessage({ text: response.data.message, type: 'success' });
            // Refresh status after distribution
            checkStatus();
        } catch (error: any) {
            setMessage({
                text: `Failed: ${error.response?.data?.error || error.message || 'Unknown error'}`,
                type: 'error'
            });
        } finally {
            setTriggering(false);
        }
    };

    const triggerReWorthAssessment = async () => {
        setReassessing(true);
        setMessage(null);
        try {
            const response = await adminApi.triggerReWorthAssessment(password);
            const successful = response.data?.result?.successful ?? 0;
            const failed = response.data?.result?.failed ?? 0;
            const eligibleUsers = response.data?.result?.eligibleUsers ?? 0;
            setMessage({
                text: `${response.data.message}. Eligible: ${eligibleUsers}, successful: ${successful}, failed: ${failed}.`,
                type: 'success'
            });
            checkStatus();
        } catch (error: any) {
            setMessage({
                text: `Failed: ${error.response?.data?.error || error.message || 'Unknown error'}`,
                type: 'error'
            });
        } finally {
            setReassessing(false);
        }
    };

    const logout = () => {
        localStorage.removeItem('adminPassword');
        setIsAuthenticated(false);
        setPassword('');
        setStatus(null);
    };

    if (!isAuthenticated) {
        return (
            <div className="admin-container">
                <Helmet>
                    <title>Admin Login - Meritocracy</title>
                </Helmet>
                <div className="admin-card login-card">
                    <h1>Admin Access</h1>
                    <form onSubmit={handleLogin}>
                        <div className="form-group">
                            <label htmlFor="password">Administrator Password</label>
                            <input
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password..."
                                required
                            />
                        </div>
                        <button type="submit" className="login-button" disabled={loading}>
                            {loading ? 'Authenticating...' : 'Access Dashboard'}
                        </button>
                    </form>
                    {message && <div className={`message ${message.type}`}>{message.text}</div>}
                </div>
            </div>
        );
    }

    return (
        <div className="admin-container">
            <Helmet>
                <title>Admin Dashboard - Meritocracy</title>
            </Helmet>
            <div className="admin-header">
                <h1>Admin Dashboard</h1>
                <button className="logout-button" onClick={logout}>Logout</button>
            </div>

            <div className="admin-grid">
                <div className="admin-card status-card">
                    <h2>Crypto Distribution Status</h2>
                    <div className="status-info">
                        <div className="status-item">
                            <span className="label">System State:</span>
                            <span className={`value ${status?.gasDistributionEnabled ? 'enabled' : 'disabled'}`}>
                                {status?.gasDistributionEnabled ? 'ACTIVE' : 'DISABLED'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="label">Next Scheduled Run:</span>
                            <span className="value">
                                {status?.cronStatus?.nextRun ? new Date(status.cronStatus.nextRun).toLocaleString() : 'Not scheduled'}
                            </span>
                        </div>
                        <div className="status-item">
                            <span className="label">Schedule:</span>
                            <span className="value">{status?.cronStatus?.schedule || 'Unknown'}</span>
                        </div>
                    </div>

                    <div className="action-buttons">
                        <button
                            className={`toggle-button ${status?.gasDistributionEnabled ? 'disable' : 'enable'}`}
                            onClick={toggleDistribution}
                            disabled={loading}
                        >
                            {status?.gasDistributionEnabled ? 'Disable Distribution' : 'Enable Distribution'}
                        </button>
                        <button
                            className="trigger-button"
                            onClick={triggerDistribution}
                            disabled={triggering || reassessing}
                        >
                            {triggering ? 'Running Distribution...' : 'Run Distribution Now'}
                        </button>
                        <button
                            className="trigger-button reassess-button"
                            onClick={triggerReWorthAssessment}
                            disabled={triggering || reassessing}
                        >
                            {reassessing ? 'Running Re-worth-assessment...' : 'Run Re-worth-assessment for Onboarded Users'}
                        </button>
                    </div>

                    {message && <div className={`message ${message.type}`}>{message.text}</div>}
                </div>

                {triggering && (
                    <div className="admin-card processing-card">
                        <h2>Processing Distribution</h2>
                        <div className="loader-container">
                            <div className="loader"></div>
                            <p>The distribution process is running. This may take a few minutes depending on the number of users and networks.</p>
                        </div>
                    </div>
                )}

                {reassessing && (
                    <div className="admin-card processing-card">
                        <h2>Processing Re-worth-assessment</h2>
                        <div className="loader-container">
                            <div className="loader"></div>
                            <p>The reassessment process is running for all onboarded users. This may take several minutes.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Admin;
