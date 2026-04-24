import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../config';
import { authenticatedFetch } from '../auth';
import './Patients.css';

export default function Patients() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const fetchPatients = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`${API_BASE}/patients`);
      if (!res.ok) throw new Error('Failed to fetch patients');
      const data = await res.json();
      setPatients(data.patients || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  const filteredPatients = patients.filter(p => {
    const q = search.toLowerCase();
    const searchable = `${p.patient_name || ''} ${p.doctor_name || ''} ${p.id || ''} ${p.patient_id}`.toLowerCase();
    return searchable.includes(q);
  });

  const formatDate = (dateStr) => {
    try {
      if (!dateStr) return '—';
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="patients-page">
      <div className="page-header">
        <h1>Patient Records</h1>
        <p>MRI brain scan analysis results with tumor segmentation data</p>
        {!loading && patients.length > 0 && (
          <div className="patient-count">
            <span className="count-dot"></span>
            <span>{patients.length} record{patients.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <div className="table-card">
        <div className="table-toolbar">
          <input
            type="text"
            className="search-box"
            placeholder="Search patients ID/Report ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="refresh-btn" onClick={fetchPatients}>
            ↻ Refresh
          </button>
        </div>

        <div className="table-body">
          {loading ? (
            <div className="state-container">
              <div className="spinner"></div>
              <span>Loading patient records…</span>
            </div>
          ) : error ? (
            <div className="state-container error-state">
              <div className="empty-icon error-icon">!</div>
              <div className="empty-text">Connection Error</div>
              <div className="empty-sub">Could not connect to the backend. Server at {API_BASE}</div>
            </div>
          ) : patients.length === 0 ? (
            <div className="state-container empty-state">
              <div className="empty-icon">📁</div>
              <div className="empty-text">No patient records</div>
              <div className="empty-sub">Process MRI scans to add patient records to the database</div>
            </div>
          ) : (
            <table className="patients-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Patient ID</th>
                  <th>Patient Name</th>
                  <th>Doctor</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((p) => (
                  <tr key={p.patient_id} className="patient-row">
                    <td>
                      <Link to={`/viewer/${p.patient_id}`} className="id-link" title={`View 3D model for patient #${p.id || p.patient_id}`}>
                        #{p.patient_id}
                      </Link>
                    </td>
                    <td>{p.id}</td>
                    <td><span className="patient-name">{p.patient_name || '—'}</span></td>
                    <td><span className="doctor-name">{p.doctor_name || '—'}</span></td>
                    <td><span className="date-cell">{formatDate(p.date)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
