import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { getToken } from '../auth';
import './Upload.css';

export default function Upload() {
  const [patientId, setPatientId] = useState('');
  const [bedNo, setBedNo] = useState('');
  const [patientName, setPatientName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [caseStudy, setCaseStudy] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [files, setFiles] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(e.target.files);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files || files.length === 0) {
      setStatus({ type: 'error', message: 'Please select a folder of MRI NIfTI files.' });
      return;
    }

    const formData = new FormData();
    formData.append('patient_id', patientId);
    formData.append('bed_no', bedNo);
    formData.append('patient_name', patientName);
    formData.append('doctor_name', doctorName);
    formData.append('case_study', caseStudy);
    formData.append('age', age);
    formData.append('sex', sex);

    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    setLoading(true);
    setStatus({ type: '', message: '' });

    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE}/process_and_store`, {
        method: 'POST',
        headers,
        body: formData
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch(err) {
        throw new Error(text || "Failed to parse JSON response");
      }

      if (!response.ok) {
        throw new Error(result.detail || "Server Error during processing");
      }

      setStatus({ type: 'success', message: `Success! Patient #${result.patient_id} stored. Redirecting...` });
      
      setTimeout(() => {
          navigate('/patients');
      }, 2000);

    } catch (err) {
      setStatus({ type: 'error', message: err.message || "An unexpected error occurred." });
      setLoading(false);
    }
  };

  return (
    <div className="upload-page">
      <div className="page-header center">
        <h1>New Patient Scan</h1>
        <p>Upload a folder consisting of NIfTI files (flair, t1, t1ce, t2) to process and store in the database.</p>
      </div>

      <div className="upload-card">
        {!loading ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group" style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="patient-id">Patient ID</label>
                <input 
                  type="text" 
                  id="patient-id" 
                  className="form-control" 
                  placeholder="e.g. 10045" 
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="bed-no">Bed No.</label>
                <input 
                  type="text" 
                  id="bed-no" 
                  className="form-control" 
                  placeholder="e.g. ICU-3" 
                  value={bedNo}
                  onChange={(e) => setBedNo(e.target.value)}
                />
              </div>
            </div>
            
            <div className="form-group">
              <label htmlFor="patient-name">Patient Name</label>
              <input 
                type="text" 
                id="patient-name" 
                className="form-control" 
                placeholder="e.g. John Doe" 
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                required 
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="doctor-name">Doctor Name</label>
              <input 
                type="text" 
                id="doctor-name" 
                className="form-control" 
                placeholder="e.g. Dr. House"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="case">Case/Study</label>
              <input 
                type="text" 
                id="case_study" 
                className="form-control" 
                placeholder="e.g. MRI Brain"
                value={caseStudy}
                onChange={(e) => setCaseStudy(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="age">Age</label>
                <input 
                  type="number" 
                  id="age" 
                  className="form-control" 
                  placeholder="e.g. 45"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  min="0"
                  max="150"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="sex">Sex</label>
                <select 
                  id="sex" 
                  className="form-control" 
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>MRI Folder (NIfTI Files)</label>
              <div 
                className={`file-drop-area ${isDragging ? 'dragover' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="file-input" 
                  onChange={handleFileChange}
                  // webkitdirectory="" directory="" are needed for folder upload
                  webkitdirectory="" 
                  directory="" 
                  multiple 
                  required={!files}
                />
                <div className="upload-icon">📁</div>
                <div className="file-msg" style={{ color: files ? 'var(--success)' : 'var(--accent)' }}>
                  {files ? `Selected ${files.length} file(s) in folder` : 'Choose a folder to upload'}
                </div>
                <div className="file-sub">Includes flair, t1, t1ce, t2 modalities</div>
              </div>
            </div>

            <button type="submit" className="btn-primary" style={{ marginTop: '16px' }}>
              Process & Store Patient
            </button>
          </form>
        ) : (
          <div className="loading-overlay active">
            <div className="spinner xl"></div>
            <div>
              <div className="loading-text">Processing MRI Data</div>
              <div className="loading-subtext">This will take a few minutes as we run the 3D extraction and tumor segmentation algorithms.</div>
            </div>
          </div>
        )}

        {status.message && (
          <div className={`status-message ${status.type}`}>
            {status.message}
          </div>
        )}
      </div>
    </div>
  );
}
