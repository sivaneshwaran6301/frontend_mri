import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { API_BASE } from '../config';
import { logout, authenticatedFetch, getToken, logoutBackend } from '../auth';
import './Viewer.css';

const COLORS = {
  brain: new THREE.Color(0xff6b8a),
  skull: new THREE.Color(0xd4c4a0),
  net: new THREE.Color(0xff4444),
  edema: new THREE.Color(0x44ff88),
  et: new THREE.Color(0xffee44),
};

function formatDate(dateStr) {
  try {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function safeJsonParse(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function formatAgeSex(patient) {
  const age = patient?.age ?? patient?.patient_age;
  const sex = patient?.sex ?? patient?.gender;
  const ageText = age ? String(age) : '';
  const sexText = sex ? String(sex) : '';
  if (ageText && sexText) return `${ageText} / ${sexText}`;
  return ageText || sexText || '—';
}

function makeMat(color, opacity) {
  const transparent = opacity < 1;
  const mat = new THREE.MeshPhongMaterial({
    color,
    transparent,
    opacity,
    side: THREE.DoubleSide,
    shininess: 30,
  });
  if (transparent) mat.depthWrite = false;
  return mat;
}

function buildGeometry(mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  geo.setIndex(new THREE.Uint32BufferAttribute(mesh.faces, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export default function Viewer() {
  const { id } = useParams();

  const canvasRef = useRef(null);
  const viewportRef = useRef(null);

  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rotGroupRef = useRef(null);
  const roRef = useRef(null);

  const [tab, setTab] = useState('3d');
  const [wireframe, setWireframe] = useState(false);

  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [visibility, setVisibility] = useState({ brain: true, skull: true, net: true, edema: true, et: true });
  const [opacities, setOpacities] = useState({ brain: 0.85, skull: 0.2, net: 1, edema: 0.9, et: 1 });

  const meshesRef = useRef({});

  const [visualInfo, setVisualInfo] = useState(null);
  const [visualLoading, setVisualLoading] = useState(false);
  const [visualError, setVisualError] = useState('');
  const [preloadedImages, setPreloadedImages] = useState({});
  const [preloadingProgress, setPreloadingProgress] = useState(0);

  // Report state
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [harvardAtlasData, setHarvardAtlasData] = useState([]);
  const [doctorComments, setDoctorComments] = useState('');
  const [aiReport, setAiReport] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [reportRightTab, setReportRightTab] = useState('atlas');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const modalities = useMemo(() => ['flair', 't1', 't1ce', 't2'], []);
  const [activeModality, setActiveModality] = useState('flair');
  const [viewMode, setViewMode] = useState('all');
  const [currentSlice, setCurrentSlice] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef(null);

  const totalSlices = useMemo(() => {
    if (!visualInfo?.modalities) return 0;
    for (const mod of modalities) {
      const info = visualInfo.modalities?.[mod];
      if (info?.loaded && info.total_slices) return info.total_slices;
    }
    return 0;
  }, [visualInfo, modalities]);

  const addOrReplaceMesh = (key, meshData, color, opacity) => {
    const rotGroup = rotGroupRef.current;
    const scene = sceneRef.current;
    if (!rotGroup || !scene) return;

    const existing = meshesRef.current[key];
    if (existing) {
      rotGroup.remove(existing);
      existing.geometry?.dispose?.();
      existing.material?.dispose?.();
      delete meshesRef.current[key];
    }

    if (!meshData) return;

    const geo = buildGeometry(meshData);
    const mat = makeMat(color, opacity);
    mat.wireframe = wireframe;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = visibility[key] ?? true;

    meshesRef.current[key] = mesh;
    rotGroup.add(mesh);
  };

  const handleAnalyzeReport = async () => {
    try {
      setAnalysisLoading(true);
      setAnalysisError('');

      const response = await authenticatedFetch(`${API_BASE}/report/analyze/${id}?token=${getToken() || ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          system_prompt: systemPrompt,
        }),
      });

      if (!response.ok) {
        let msg = 'Failed to analyze report';
        try {
          const err = await response.json();
          if (err?.detail) msg = err.detail;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const result = await response.json();
      setAiReport(result.ai_report || '');
    } catch (error) {
      console.error('Error analyzing report:', error);
      setAnalysisError(error?.message || 'Failed to analyze report');
    } finally {
      setAnalysisLoading(false);
    }
  };

  const updateMeshVisibility = (key, isVisible) => {
    const mesh = meshesRef.current[key];
    if (mesh) mesh.visible = isVisible;
  };

  const updateMeshOpacity = (key, opacity) => {
    const mesh = meshesRef.current[key];
    if (!mesh) return;
    const mat = mesh.material;
    if (!mat) return;

    mat.opacity = opacity;
    mat.transparent = opacity < 1;
    mat.depthWrite = opacity >= 1;
    mat.needsUpdate = true;
  };

  const applyWireframe = (enabled) => {
    for (const k of Object.keys(meshesRef.current)) {
      const m = meshesRef.current[k];
      if (m?.material) {
        m.material.wireframe = enabled;
        m.material.needsUpdate = true;
      }
    }
  };

  useEffect(() => {
    if (tab !== '3d') return;
    if (!canvasRef.current || !viewportRef.current) return;

    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x050810, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);

    const rotGroup = new THREE.Group();
    scene.add(rotGroup);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.65);
    dirLight.position.set(0.7, 0.7, -1.0).normalize();
    scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0x88aaff, 0.25);
    backLight.position.set(-1, -0.5, 1);
    scene.add(backLight);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    rotGroupRef.current = rotGroup;

    let isDragging = false;
    let isPanning = false;
    let prevMouse = { x: 0, y: 0 };
    let zoom = 3.0;
    const panOffset = new THREE.Vector3();

    const updateCamera = () => {
      camera.position.set(panOffset.x, panOffset.y, zoom);
    };
    updateCamera();

    const onMouseDown = (e) => {
      if (e.shiftKey) isPanning = true;
      else isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
      isPanning = false;
    };

    const onMouseMove = (e) => {
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;

      if (isDragging) {
        const qY = new THREE.Quaternion();
        qY.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.007);
        const qX = new THREE.Quaternion();
        qX.setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.007);
        rotGroup.quaternion.multiplyQuaternions(qY, rotGroup.quaternion);
        rotGroup.quaternion.multiplyQuaternions(qX, rotGroup.quaternion);
      }

      if (isPanning) {
        panOffset.x += dx * zoom * 0.001;
        panOffset.y -= dy * zoom * 0.001;
        updateCamera();
      }

      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onWheel = (e) => {
      zoom = Math.max(0.5, Math.min(10.0, zoom + e.deltaY * 0.005));
      updateCamera();
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel);

    const resize = () => {
      const vp = viewportRef.current;
      if (!vp) return;
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    roRef.current = new ResizeObserver(resize);
    roRef.current.observe(viewportRef.current);
    resize();

    let rafId = 0;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();

    const resetFn = () => {
      rotGroup.quaternion.identity();
      panOffset.set(0, 0, 0);
      zoom = 3.0;
      updateCamera();
    };

    const api = {
      resetCamera: resetFn,
      screenshot: () => {
        try {
          renderer.render(scene, camera);
          const url = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = url;
          a.download = `patient_${id}_screenshot.png`;
          a.click();
        } catch {
          return;
        }
      },
    };

    canvasRef.current.__viewerApi = api;

    return () => {
      cancelAnimationFrame(rafId);
      roRef.current?.disconnect?.();
      roRef.current = null;
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);

      for (const k of Object.keys(meshesRef.current)) {
        const m = meshesRef.current[k];
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
      meshesRef.current = {};

      renderer.dispose();

      if (canvasRef.current) delete canvasRef.current.__viewerApi;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      rotGroupRef.current = null;
    };
  }, [id, tab]);

  useEffect(() => {
    const loadPatient = async () => {
      if (!id) {
        setLoadError('No patient ID specified');
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError('');

      try {
        const res = await authenticatedFetch(`${API_BASE}/patients/${id}`);
        if (!res.ok) throw new Error('Patient not found');
        const data = await res.json();
        setPatient(data);

        const brainData = safeJsonParse(data.brain_mesh);
        const skullData = safeJsonParse(data.skull_mesh);
        const netData = safeJsonParse(data.NET);
        const etData = safeJsonParse(data.ET);
        const edemaData = safeJsonParse(data.edema);

        if (brainData?.mesh) addOrReplaceMesh('brain', brainData.mesh, COLORS.brain, opacities.brain);
        if (skullData?.mesh) addOrReplaceMesh('skull', skullData.mesh, COLORS.skull, opacities.skull);
        if (netData?.mesh) addOrReplaceMesh('net', netData.mesh, COLORS.net, opacities.net);
        if (edemaData?.mesh) addOrReplaceMesh('edema', edemaData.mesh, COLORS.edema, opacities.edema);
        if (etData?.mesh) addOrReplaceMesh('et', etData.mesh, COLORS.et, opacities.et);
      } catch (e) {
        setLoadError(e?.message || 'Failed to load patient');
      } finally {
        setLoading(false);
      }
    };

    loadPatient();
  }, [id]);

  useEffect(() => {
    if (tab !== '3d') return;
    if (!patient) return;
    if (!rotGroupRef.current || !sceneRef.current) return;

    const brainData = safeJsonParse(patient.brain_mesh);
    const skullData = safeJsonParse(patient.skull_mesh);
    const netData = safeJsonParse(patient.NET);
    const etData = safeJsonParse(patient.ET);
    const edemaData = safeJsonParse(patient.edema);

    if (brainData?.mesh) addOrReplaceMesh('brain', brainData.mesh, COLORS.brain, opacities.brain);
    if (skullData?.mesh) addOrReplaceMesh('skull', skullData.mesh, COLORS.skull, opacities.skull);
    if (netData?.mesh) addOrReplaceMesh('net', netData.mesh, COLORS.net, opacities.net);
    if (edemaData?.mesh) addOrReplaceMesh('edema', edemaData.mesh, COLORS.edema, opacities.edema);
    if (etData?.mesh) addOrReplaceMesh('et', etData.mesh, COLORS.et, opacities.et);
  }, [tab, patient]);

  useEffect(() => {
    for (const k of Object.keys(visibility)) {
      updateMeshVisibility(k, visibility[k]);
    }
  }, [visibility]);

  useEffect(() => {
    for (const k of Object.keys(opacities)) {
      updateMeshOpacity(k, opacities[k]);
    }
  }, [opacities]);

  useEffect(() => {
    applyWireframe(wireframe);
  }, [wireframe]);

  const preloadSliceImages = async (visualData) => {
    const preloaded = {};
    let totalImagesToLoad = 0;
    let imagesLoaded = 0;

    // Calculate total images to load
    for (const mod of modalities) {
      const info = visualData?.modalities?.[mod];
      if (info?.loaded) {
        totalImagesToLoad += info.total_slices;
      }
    }

    if (totalImagesToLoad === 0) {
      setPreloadingProgress(100);
      return;
    }

    // Preload all slices for each modality using batch requests
    for (const mod of modalities) {
      const info = visualData?.modalities?.[mod];
      if (!info?.loaded) continue;

      preloaded[mod] = [];
      const totalSlices = info.total_slices;
      const batchSize = 25; // Load 25 slices at a time

      // Load slices in batches
      for (let start = 0; start < totalSlices; start += batchSize) {
        const end = Math.min(start + batchSize, totalSlices);

        try {
          const response = await authenticatedFetch(
            `${API_BASE}/patients/${id}/visual/batch/${mod}?start_idx=${start}&end_idx=${end}`
          );

          if (!response.ok) throw new Error(`Batch request failed for ${mod}`);

          const batchData = await response.json();

          // Convert base64 images to Image objects
          for (let slice = start; slice < end; slice++) {
            const base64Data = batchData.slices[slice.toString()];
            if (base64Data) {
              const img = new Image();
              img.src = `data:image/png;base64,${base64Data}`;

              // Wait for image to load
              await new Promise((resolve) => {
                img.onload = () => {
                  imagesLoaded++;
                  const progress = Math.round((imagesLoaded / totalImagesToLoad) * 100);
                  setPreloadingProgress(progress);
                  resolve();
                };
                img.onerror = () => {
                  imagesLoaded++;
                  const progress = Math.round((imagesLoaded / totalImagesToLoad) * 100);
                  setPreloadingProgress(progress);
                  resolve(); // Continue even if one image fails
                };
              });

              preloaded[mod][slice] = img;
            }
          }
        } catch (error) {
          console.error(`Failed to load batch ${start}-${end} for ${mod}:`, error);
          // Fallback to individual slice loading for this batch
          for (let slice = start; slice < end; slice++) {
            try {
              const img = new Image();
              const url = `${API_BASE}/patients/${id}/visual/slice/${mod}/${slice}?token=${getToken() || ''}`;

              await new Promise((resolve) => {
                img.onload = () => {
                  imagesLoaded++;
                  const progress = Math.round((imagesLoaded / totalImagesToLoad) * 100);
                  setPreloadingProgress(progress);
                  resolve();
                };
                img.onerror = () => {
                  imagesLoaded++;
                  const progress = Math.round((imagesLoaded / totalImagesToLoad) * 100);
                  setPreloadingProgress(progress);
                  resolve();
                };
                img.src = url;
              });

              preloaded[mod][slice] = img;
            } catch (sliceError) {
              console.error(`Failed to load slice ${slice} for ${mod}:`, sliceError);
            }
          }
        }
      }
    }

    setPreloadedImages(preloaded);
  };

  useEffect(() => {
    if (tab !== 'visual') return;
    if (visualInfo || visualLoading) return;

    const loadInfo = async () => {
      setVisualLoading(true);
      setVisualError('');
      setPreloadingProgress(0);
      try {
        const res = await authenticatedFetch(`${API_BASE}/patients/${id}/visual/info`);
        if (!res.ok) throw new Error('Visual info unavailable');
        const data = await res.json();
        setVisualInfo(data);

        // Preload all slice images
        await preloadSliceImages(data);

        for (const mod of modalities) {
          if (data?.modalities?.[mod]?.loaded) {
            setActiveModality(mod);
            break;
          }
        }
        setCurrentSlice(0);
      } catch (e) {
        setVisualError(e?.message || 'Failed to load visual info');
      } finally {
        setVisualLoading(false);
      }
    };

    loadInfo();
  }, [tab, id, visualInfo, visualLoading, modalities]);

  // Load report data when report tab is selected
  useEffect(() => {
    if (tab !== 'report') return;
    if (reportData || reportLoading) return;

    const loadReportData = async () => {
      setReportLoading(true);
      setReportError('');

      try {
        // Load report data
        const reportResponse = await authenticatedFetch(`${API_BASE}/report/get/${id}?token=${getToken() || ''}`);
        if (reportResponse.ok) {
          const report = await reportResponse.json();
          setReportData(report);
          setDoctorComments(report.doctor_comments || '');
          setAiReport(report.ai_report || '');
          setSystemPrompt(report.system_prompt || '');
        } else if (reportResponse.status === 404) {
          // No report exists yet, that's okay
          setReportData({});
        } else {
          throw new Error('Failed to load report data');
        }

        // Load Harvard atlas data
        const atlasResponse = await authenticatedFetch(`${API_BASE}/report/harvard-atlas/${id}?token=${getToken() || ''}`);
        if (atlasResponse.ok) {
          const atlasResult = await atlasResponse.json();
          setHarvardAtlasData(atlasResult.atlas_data || []);
        } else {
          throw new Error('Failed to load atlas data');
        }
      } catch (error) {
        console.error('Error loading report data:', error);
        setReportError('Failed to load report data');
      } finally {
        setReportLoading(false);
      }
    };

    loadReportData();
  }, [tab, id, reportData, reportLoading]);

  const handleSaveReport = async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE}/report/save/${id}?token=${getToken() || ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctor_comments: doctorComments,
          ai_report: aiReport,
          system_prompt: systemPrompt,
        }),
      });

      if (response.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        return true;
      } else {
        throw new Error('Failed to save report');
      }
    } catch (error) {
      console.error('Error saving report:', error);
      return false;
    }
  };

  const handleExportPDF = async () => {
    try {
      const saved = await handleSaveReport();
      if (!saved) {
        alert('Failed to save report before export. Please try again.');
        return;
      }

      const response = await authenticatedFetch(`${API_BASE}/report/pdf/${id}?token=${getToken() || ''}`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Get filename from headers or create default
        const contentDisposition = response.headers.get('content-disposition');
        let filename = `tumor_analysis_report_${id}.pdf`;
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="(.+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        console.log('PDF exported successfully');
      } else {
        let detail = '';
        try {
          const ct = response.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const err = await response.json();
            detail = err?.detail ? String(err.detail) : JSON.stringify(err);
          } else {
            detail = await response.text();
          }
        } catch {
          // ignore
        }

        const msg = detail ? `Failed to export PDF: ${detail}` : 'Failed to export PDF';
        throw new Error(msg);
      }
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert(error?.message || 'Failed to export PDF. Please try again.');
    }
  };

  useEffect(() => {
    if (!isPlaying) return;
    if (!totalSlices) {
      setIsPlaying(false);
      return;
    }

    playIntervalRef.current = setInterval(() => {
      setCurrentSlice((s) => {
        const next = s + 1;
        return next >= totalSlices ? 0 : next;
      });
    }, 100);

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    };
  }, [isPlaying, totalSlices]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (tab !== 'visual' || !totalSlices) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentSlice((s) => (s + 1 >= totalSlices ? 0 : s + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentSlice((s) => (s - 1 < 0 ? totalSlices - 1 : s - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, totalSlices]);

  const onWheelVisual = (e) => {
    if (tab !== 'visual' || !totalSlices) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1 : -1;
    setCurrentSlice((s) => {
      let n = s + delta;
      if (n >= totalSlices) n = 0;
      if (n < 0) n = totalSlices - 1;
      return n;
    });
  };

  const volumes = useMemo(() => {
    const brainData = safeJsonParse(patient?.brain_mesh);
    const netData = safeJsonParse(patient?.NET);
    const etData = safeJsonParse(patient?.ET);
    const edemaData = safeJsonParse(patient?.edema);

    const brainVol = brainData?.volume_cm3 || 0;
    const netVol = netData?.volume_cm3 || 0;
    const etVol = etData?.volume_cm3 || 0;
    const edemaVol = edemaData?.volume_cm3 || 0;

    return { brainVol, netVol, etVol, edemaVol };
  }, [patient]);

  const sliceInfoText = `${Math.min(currentSlice + 1, totalSlices || 0)} / ${totalSlices || 0}`;

  return (
    <div className="viewer-root">
      <header className="viewer-header">
        <Link to="/patients" className="viewer-logo">Synapt<span>assistaX</span> · Patient Viewer</Link>

        <div className="viewer-tab-nav">
          <button
            className={`viewer-tab-btn ${tab === '3d' ? 'active' : ''}`}
            onClick={() => setTab('3d')}
            type="button"
          >
            3D Model
          </button>
          <button
            className={`viewer-tab-btn ${tab === 'visual' ? 'active' : ''}`}
            onClick={() => setTab('visual')}
            type="button"
          >
            Visual Reference
          </button>
          <button
            className={`viewer-tab-btn ${tab === 'report' ? 'active' : ''}`}
            onClick={() => setTab('report')}
            type="button"
          >
            Report
          </button>
        </div>

        <div className="viewer-header-info">
          <span className="viewer-header-badge">DB #{id || '—'}</span>
          {patient?.patient_id && <span className="viewer-header-badge">Patient ID: {patient.patient_id}</span>}
          <span className="viewer-header-badge">{patient?.patient_name || 'Loading...'}</span>
          <Link to="/patients" className="viewer-nav-link">← All Patients</Link>
          <button onClick={async () => { await logoutBackend(); window.location.href = '/login'; }} className="viewer-nav-link logout-btn" type="button">
            Logout
          </button>
        </div>
      </header>

      <div className="viewer-layout">
        {tab === '3d' ? (
          <>
            <div className="viewer-panel">
              <div>
                <div className="viewer-section-title">Patient Information</div>
                <div className="viewer-info-card">
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">DB ID</span>
                    <span className="viewer-info-value accent">#{id || '—'}</span>
                  </div>
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">Patient ID</span>
                    <span className="viewer-info-value accent">{patient?.patient_id || '—'}</span>
                  </div>
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">Bed No</span>
                    <span className="viewer-info-value">{patient?.bed_no || '—'}</span>
                  </div>
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">Name</span>
                    <span className="viewer-info-value">{patient?.patient_name || '—'}</span>
                  </div>
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">Doctor</span>
                    <span className="viewer-info-value">{patient?.doctor_name || '—'}</span>
                  </div>
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">Case/Study</span>
                    <span className="viewer-info-value">{patient?.case_study || 'MRI Brain'}</span>
                  </div>
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">Age / Sex</span>
                    <span className="viewer-info-value">{formatAgeSex(patient)}</span>
                  </div>
                  <div className="viewer-info-row">
                    <span className="viewer-info-label">Date</span>
                    <span className="viewer-info-value">{patient?.date ? formatDate(patient.date) : '—'}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="viewer-section-title">Measurements</div>
                <div className="viewer-stats-grid">
                  <div className="viewer-stat-card">
                    <div className="viewer-stat-label">Brain Vol</div>
                    <div className="viewer-stat-value">{volumes.brainVol.toFixed(1)}</div>
                    <div className="viewer-stat-unit">cm³</div>
                  </div>
                  <div className="viewer-stat-card">
                    <div className="viewer-stat-label">NET</div>
                    <div className="viewer-stat-value">{volumes.netVol.toFixed(2)}</div>
                    <div className="viewer-stat-unit">cm³</div>
                  </div>
                  <div className="viewer-stat-card">
                    <div className="viewer-stat-label">Edema</div>
                    <div className="viewer-stat-value">{volumes.edemaVol.toFixed(2)}</div>
                    <div className="viewer-stat-unit">cm³</div>
                  </div>
                  <div className="viewer-stat-card">
                    <div className="viewer-stat-label">ET</div>
                    <div className="viewer-stat-value">{volumes.etVol.toFixed(2)}</div>
                    <div className="viewer-stat-unit">cm³</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="viewer-section-title">Layers</div>

                <div className="viewer-legend">
                  <button className={`viewer-legend-row ${visibility.brain ? '' : 'off'}`} type="button" onClick={() => setVisibility(v => ({ ...v, brain: !v.brain }))}>
                    <span className="viewer-dot" style={{ background: 'var(--brain)' }} />
                    <span className="viewer-legend-label">Brain</span>
                    <span className="viewer-legend-vol">{volumes.brainVol.toFixed(1)} cm³</span>
                  </button>

                  <button className={`viewer-legend-row ${visibility.skull ? '' : 'off'}`} type="button" onClick={() => setVisibility(v => ({ ...v, skull: !v.skull }))}>
                    <span className="viewer-dot" style={{ background: 'var(--skull)' }} />
                    <span className="viewer-legend-label">Skull</span>
                    <span className="viewer-legend-vol">—</span>
                  </button>

                  <button className={`viewer-legend-row ${visibility.net ? '' : 'off'}`} type="button" onClick={() => setVisibility(v => ({ ...v, net: !v.net }))}>
                    <span className="viewer-dot" style={{ background: 'var(--net)' }} />
                    <span className="viewer-legend-label">NCR / NET</span>
                    <span className="viewer-legend-vol">{volumes.netVol.toFixed(1)} cm³</span>
                  </button>

                  <button className={`viewer-legend-row ${visibility.edema ? '' : 'off'}`} type="button" onClick={() => setVisibility(v => ({ ...v, edema: !v.edema }))}>
                    <span className="viewer-dot" style={{ background: 'var(--edema)' }} />
                    <span className="viewer-legend-label">Edema</span>
                    <span className="viewer-legend-vol">{volumes.edemaVol.toFixed(1)} cm³</span>
                  </button>

                  <button className={`viewer-legend-row ${visibility.et ? '' : 'off'}`} type="button" onClick={() => setVisibility(v => ({ ...v, et: !v.et }))}>
                    <span className="viewer-dot" style={{ background: 'var(--et)' }} />
                    <span className="viewer-legend-label">Enhancing Tumor</span>
                    <span className="viewer-legend-vol">{volumes.etVol.toFixed(1)} cm³</span>
                  </button>
                </div>

                <div className="viewer-opacity">
                  <div className="viewer-section-title" style={{ marginBottom: 0 }}>Opacity</div>

                  <div className="viewer-opacity-row">
                    <span className="viewer-opacity-dot" style={{ background: 'var(--brain)' }} />
                    <input type="range" min="0" max="100" value={Math.round(opacities.brain * 100)} onChange={(e) => setOpacities(o => ({ ...o, brain: Number(e.target.value) / 100 }))} />
                  </div>

                  <div className="viewer-opacity-row">
                    <span className="viewer-opacity-dot" style={{ background: 'var(--skull)' }} />
                    <input type="range" min="0" max="100" value={Math.round(opacities.skull * 100)} onChange={(e) => setOpacities(o => ({ ...o, skull: Number(e.target.value) / 100 }))} />
                  </div>

                  <div className="viewer-opacity-row">
                    <span className="viewer-opacity-dot" style={{ background: 'var(--net)' }} />
                    <input type="range" min="0" max="100" value={Math.round(opacities.net * 100)} onChange={(e) => setOpacities(o => ({ ...o, net: Number(e.target.value) / 100 }))} />
                  </div>

                  <div className="viewer-opacity-row">
                    <span className="viewer-opacity-dot" style={{ background: 'var(--edema)' }} />
                    <input type="range" min="0" max="100" value={Math.round(opacities.edema * 100)} onChange={(e) => setOpacities(o => ({ ...o, edema: Number(e.target.value) / 100 }))} />
                  </div>

                  <div className="viewer-opacity-row">
                    <span className="viewer-opacity-dot" style={{ background: 'var(--et)' }} />
                    <input type="range" min="0" max="100" value={Math.round(opacities.et * 100)} onChange={(e) => setOpacities(o => ({ ...o, et: Number(e.target.value) / 100 }))} />
                  </div>
                </div>

                <div className="viewer-toggles">
                  <button className="viewer-btn" type="button" onClick={() => setWireframe(w => !w)}>
                    {wireframe ? 'Wireframe: On' : 'Wireframe: Off'}
                  </button>
                </div>
              </div>
            </div>

            <div className="viewer-viewport" ref={viewportRef}>
              {loading && (
                <div className="viewer-overlay">
                  <div className="viewer-spinner" />
                  <div className="viewer-overlay-text">Loading patient data…</div>
                </div>
              )}

              {!loading && loadError && (
                <div className="viewer-overlay error">
                  <div className="viewer-overlay-text">{loadError}</div>
                </div>
              )}

              <canvas className="viewer-canvas" ref={canvasRef} />

              <div className="viewer-orientation-marker left-side">L</div>
              <div className="viewer-orientation-marker right-side">R</div>

              <div className="viewer-hud">
                <button className="viewer-hud-btn" type="button" onClick={() => canvasRef.current?.__viewerApi?.resetCamera?.()}>
                  ⌂ Reset
                </button>
                <button className="viewer-hud-btn" type="button" onClick={() => setWireframe(w => !w)}>
                  ◈ Wireframe
                </button>
                <button className="viewer-hud-btn" type="button" onClick={() => canvasRef.current?.__viewerApi?.screenshot?.()}>
                  ↓ Screenshot
                </button>
              </div>

              <div className="viewer-camera-hint">Drag · rotate | Scroll · zoom | Shift+drag · pan</div>
            </div>
          </>
        ) : tab === 'visual' ? (
          <>
            <div className="viewer-visual-left">
              <div className="viewer-section-title">Modalities</div>
              <div className="viewer-modality-list">
                {modalities.map((mod) => {
                  const info = visualInfo?.modalities?.[mod];
                  const loaded = !!info?.loaded;
                  const active = mod === activeModality;
                  return (
                    <button
                      key={mod}
                      type="button"
                      className={`viewer-modality-item ${active ? 'active' : ''} ${loaded ? '' : 'disabled'}`}
                      onClick={() => loaded && setActiveModality(mod)}
                      disabled={!loaded}
                    >
                      <span className="viewer-modality-color" style={{ background: mod === 'flair' ? '#ff6b8a' : mod === 't1' ? '#7c3aed' : mod === 't1ce' ? '#00e5ff' : '#44ff88' }} />
                      <span className="viewer-modality-label">{mod.toUpperCase()}</span>
                      <span className="viewer-modality-status">{loaded ? `${info.total_slices} slices` : '—'}</span>
                    </button>
                  );
                })}
              </div>

              <div className="viewer-section-title" style={{ marginTop: 20 }}>View Mode</div>
              <div className="viewer-modality-list">
                <button type="button" className={`viewer-modality-item ${viewMode === 'all' ? 'active' : ''}`} onClick={() => setViewMode('all')}>
                  <span className="viewer-modality-label">All 4 Views</span>
                </button>
                <button type="button" className={`viewer-modality-item ${viewMode === 'single' ? 'active' : ''}`} onClick={() => setViewMode('single')}>
                  <span className="viewer-modality-label">Single View</span>
                </button>
              </div>

              <div className="viewer-section-title" style={{ marginTop: 20 }}>Controls</div>
              <div className="viewer-visual-controls">
                <label className="viewer-visual-label">Slice</label>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, totalSlices - 1)}
                  value={Math.min(currentSlice, Math.max(0, totalSlices - 1))}
                  onChange={(e) => setCurrentSlice(Number(e.target.value))}
                  disabled={!totalSlices}
                />
                <div className="viewer-slice-counter">{sliceInfoText}</div>
                <button className="viewer-btn" type="button" onClick={() => setIsPlaying(p => !p)} disabled={!totalSlices}>
                  {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
              </div>
            </div>

            <div className="viewer-visual-right" onWheel={onWheelVisual}>
              {visualLoading && (
                <div className="viewer-overlay">
                  <div className="viewer-spinner" />
                  <div className="viewer-overlay-text">
                    {preloadingProgress > 0 ? `Preloading images: ${preloadingProgress}%` : 'Loading visual data…'}
                  </div>
                  {preloadingProgress > 0 && (
                    <div className="viewer-progress-bar">
                      <div
                        className="viewer-progress-fill"
                        style={{ width: `${preloadingProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {!visualLoading && visualError && (
                <div className="viewer-overlay error">
                  <div className="viewer-overlay-text">{visualError}</div>
                </div>
              )}

              {!visualLoading && !visualError && visualInfo && totalSlices === 0 && (
                <div className="viewer-overlay">
                  <div className="viewer-overlay-text">No NIfTI modality files stored for this patient</div>
                </div>
              )}

              {!visualLoading && !visualError && totalSlices > 0 && (
                viewMode === 'single' ? (
                  <div className="viewer-visual-single">
                    <div className="viewer-visual-header">
                      <div className="viewer-visual-title">▮ {activeModality.toUpperCase()} View</div>
                      <div className="viewer-visual-slice">Slice {sliceInfoText}</div>
                    </div>
                    <div className="viewer-visual-content">
                      <div className="viewer-orientation-marker left-side">L</div>
                      <div className="viewer-orientation-marker right-side">R</div>
                      {preloadedImages[activeModality]?.[currentSlice] ? (
                        <img
                          className="viewer-slice-img"
                          alt="MRI Slice"
                          src={preloadedImages[activeModality][currentSlice].src}
                        />
                      ) : (
                        <img
                          className="viewer-slice-img"
                          alt="MRI Slice"
                          src={`${API_BASE}/patients/${id}/visual/slice/${activeModality}/${currentSlice}?token=${getToken() || ''}`}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="viewer-visual-grid">
                    <div className="viewer-visual-header">
                      <div className="viewer-visual-title">▮ Multi-Modality View</div>
                      <div className="viewer-visual-slice">Slice {sliceInfoText}</div>
                    </div>

                    <div className="viewer-grid">
                      {modalities.map((mod) => {
                        const info = visualInfo?.modalities?.[mod];
                        const loaded = !!info?.loaded;
                        return (
                          <div key={mod} className="viewer-grid-item">
                            <div className="viewer-grid-header">
                              <span style={{ color: mod === 'flair' ? '#ff6b8a' : mod === 't1' ? '#7c3aed' : mod === 't1ce' ? '#00e5ff' : '#44ff88' }}>{mod.toUpperCase()}</span>
                              <span>{loaded ? `${info.total_slices} slices` : '—'}</span>
                            </div>
                            <div className="viewer-grid-content">
                              {loaded ? (
                                <>
                                  <div className="viewer-orientation-marker left-side">L</div>
                                  <div className="viewer-orientation-marker right-side">R</div>
                                  {preloadedImages[mod]?.[currentSlice] ? (
                                    <img alt={mod.toUpperCase()} src={preloadedImages[mod][currentSlice].src} />
                                  ) : (
                                    <img alt={mod.toUpperCase()} src={`${API_BASE}/patients/${id}/visual/slice/${mod}/${currentSlice}?token=${getToken() || ''}`} />
                                  )}
                                </>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>
          </>
        ) : tab === 'report' ? (
          <>
            <div className="viewer-report-left">
              <div className="viewer-section-title">Doctor Comments</div>
              <textarea
                className="viewer-report-textarea"
                placeholder="Enter clinical questions, patient symptoms, or additional context for the AI..."
                value={doctorComments}
                onChange={(e) => setDoctorComments(e.target.value)}
                rows={4}
              />

              <div className="viewer-report-actions">
                <button className="viewer-btn primary" type="button" onClick={handleAnalyzeReport} disabled={analysisLoading}>
                  {analysisLoading ? '⏳ Analysing…' : '🔬 Analyse'}
                </button>
                <button className="viewer-btn primary" type="button" onClick={handleSaveReport}>
                  {saveSuccess ? '✓ Saved' : '💾 Save Report'}
                </button>
                <button className="viewer-btn secondary" type="button" onClick={handleExportPDF}>
                  📄 Export PDF
                </button>
              </div>

              <div className="viewer-report-hint">
                💡 Doctor comments are included in the AI prompt to personalize the analysis.
              </div>
            </div>

            <div className="viewer-report-right">
              <div className="viewer-right-tabs">
                <button
                  type="button"
                  className={`viewer-right-tab-btn ${reportRightTab === 'atlas' ? 'active' : ''}`}
                  onClick={() => setReportRightTab('atlas')}
                >
                  Tumor (Harvard/Oxford)
                </button>
                <button
                  type="button"
                  className={`viewer-right-tab-btn ${reportRightTab === 'ai' ? 'active' : ''}`}
                  onClick={() => setReportRightTab('ai')}
                >
                  AI Generated Report
                </button>
              </div>

              {reportLoading && (
                <div className="viewer-overlay">
                  <div className="viewer-spinner" />
                  <div className="viewer-overlay-text">Loading report data...</div>
                </div>
              )}

              {!reportLoading && reportError && (
                <div className="viewer-overlay error">
                  <div className="viewer-overlay-text">{reportError}</div>
                </div>
              )}

              {!reportLoading && !reportError && (
                <div className="viewer-report-content">
                  {reportRightTab === 'atlas' ? (
                    harvardAtlasData.length === 0 ? (
                      <div className="viewer-empty-state">
                        <div>No Harvard Oxford atlas data available for this patient</div>
                      </div>
                    ) : (
                      <div className="viewer-atlas-tables">
                        {['net', 'edema', 'et'].map((tumorClass) => {
                          const classData = harvardAtlasData.filter(d => d.tumor_class === tumorClass);
                          if (classData.length === 0) return null;

                          const corticalData = classData.filter(d => d.region_type === 'cortical');
                          const subcorticalData = classData.filter(d => d.region_type === 'subcortical');

                          const className = tumorClass === 'net' ? 'NCR/NET (1)' :
                            tumorClass === 'edema' ? 'Edema (2)' : 'Enhancing Tumor (3)';

                          return (
                            <div key={tumorClass} className="viewer-tumor-class-section">
                              <div className="viewer-tumor-class-title">Tumor Class: {className}</div>

                              {corticalData.length > 0 && (
                                <div className="viewer-region-section">
                                  <div className="viewer-region-title">Cortical Regions Involved</div>
                                  <AtlasTable data={corticalData} />
                                </div>
                              )}

                              {subcorticalData.length > 0 && (
                                <div className="viewer-region-section">
                                  <div className="viewer-region-title">Subcortical Regions Involved</div>
                                  <AtlasTable data={subcorticalData} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <>
                      <div className="viewer-section-title">AI Generated Clinical Report</div>
                      <div className="clinical-report-wrap">
                        <div className="clinical-report-page">
                          {/* Header */}
                          <div className="clinical-report-header">
                            <div className="clinical-report-header-title">DEPARTMENT OF RADIOLOGY</div>
                            <div className="clinical-report-header-sub">MRI Brain Tumor Analysis — Clinical Report</div>
                          </div>

                          {/* Patient Table */}
                          <div className="clinical-report-patient-table">
                            <div className="clinical-report-patient-row">
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Patient</div>
                                <div className="clinical-report-value">{patient?.patient_name || '—'}</div>
                              </div>
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Age / Sex</div>
                                <div className="clinical-report-value">{formatAgeSex(patient)}</div>
                              </div>
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Report ID</div>
                                <div className="clinical-report-value">#{id || '—'}</div>
                              </div>
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Patient ID</div>
                                <div className="clinical-report-value">{patient?.patient_id || '—'}</div>
                              </div>
                            </div>
                            <div className="clinical-report-patient-row">
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Study</div>
                                <div className="clinical-report-value">{patient?.case_study || 'MRI Brain'}</div>
                              </div>
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Bed No</div>
                                <div className="clinical-report-value">{patient?.bed_no || '—'}</div>
                              </div>
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Referring Doctor</div>
                                <div className="clinical-report-value">{patient?.doctor_name || '—'}</div>
                              </div>
                              <div className="clinical-report-patient-cell">
                                <div className="clinical-report-label">Reported On</div>
                                <div className="clinical-report-value">{patient?.date ? formatDate(patient.date) : '—'}</div>
                              </div>
                            </div>
                          </div>

                          {/* Doctor Comments block (if present) */}
                          {doctorComments?.trim() ? (
                            <div className="clinical-report-section">
                              <div className="clinical-report-section-title">Referring Doctor Comments</div>
                              <div className="clinical-report-paragraph">{doctorComments}</div>
                            </div>
                          ) : null}

                          {/* Main AI Report Body (without the clinical summary markers) */}
                          <ClinicalReportPreview
                            text={aiReport}
                            emptyPlaceholder="Click 'Analyse' to generate an AI clinical report..."
                          />

                          {/* Clinical Summary Panel */}
                          <ClinicalSummaryPanel aiReport={aiReport} />
                        </div>
                      </div>
                      {analysisError ? (
                        <div className="viewer-error-text" style={{ marginTop: 8 }}>
                          {analysisError}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// Helper component for Atlas tables
function AtlasTable({ data }) {
  return (
    <div className="viewer-atlas-table">
      <div className="viewer-table-header">
        <div>Region</div>
        <div>Overlap Voxels</div>
        <div>% of Tumor</div>
        <div>% of Region Affected</div>
      </div>
      {data.map((row, index) => (
        <div key={index} className="viewer-table-row">
          <div className="viewer-table-cell region">{row.region_name}</div>
          <div className="viewer-table-cell number">{row.overlap_voxels}</div>
          <div className="viewer-table-cell number">{row.percent_tumor.toFixed(2)}%</div>
          <div className="viewer-table-cell number">{row.percent_region_affected.toFixed(2)}%</div>
        </div>
      ))}
    </div>
  );
}

function ClinicalReportPreview({ text, emptyPlaceholder }) {
  const MARKERS = [
    '%%RISK_ASSESSMENT%%', '%%TUMOR_GRADE%%', '%%RECOMMENDED_DIAGNOSIS%%',
    '%%TREATMENT_RECOMMENDATIONS%%', '%%CRITICAL_FINDINGS%%',
  ];

  const stripMarkers = (txt) => {
    let firstPos = txt.length;
    for (const m of MARKERS) {
      const pos = txt.indexOf(m);
      if (pos !== -1 && pos < firstPos) firstPos = pos;
    }
    return txt.slice(0, firstPos).replace(/\n[-=*#]{3,}\s*$/m, '').trimEnd();
  };

  const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const displayText = stripMarkers(normalized);

  const blocks = [];
  let current = [];
  const pushCurrent = () => {
    const trimmed = current.join('\n').trim();
    if (trimmed) blocks.push(trimmed);
    current = [];
  };
  for (const ln of displayText.split('\n')) {
    if (!ln.trim()) { pushCurrent(); continue; }
    current.push(ln);
  }
  pushCurrent();

  if (!blocks.length) {
    return (
      <div className="clinical-report-section">
        <div className="clinical-report-paragraph muted">{emptyPlaceholder}</div>
      </div>
    );
  }

  const isHeadingLine = (s) => {
    const t = s.replace(/[*_`#]+/g, '').trim();
    if (!t || t.length <= 2) return false;
    if (t.endsWith(':') && t.length < 80) return true;
    const upperish = t === t.toUpperCase() && /[A-Z]/.test(t);
    const safe = /^[A-Z0-9][A-Z0-9 /()\-,.]{2,}$/.test(t);
    return upperish && safe;
  };

  const renderBlock = (block, idx) => {
    const blockLines = block.split('\n');
    const first = blockLines[0].replace(/[*_`#]+/g, '').trim();
    const heading = isHeadingLine(first) ? first.replace(/:$/, '') : '';
    const restLines = heading ? blockLines.slice(1) : blockLines;

    const listItems = [];
    const paragraphs = [];
    let para = [];
    const flushPara = () => {
      const p = para.join(' ').trim();
      if (p) paragraphs.push(p);
      para = [];
    };

    for (const raw of restLines) {
      const s = raw.replace(/[*_`]+/g, '').trim();
      if (!s) { flushPara(); continue; }
      const bm = s.match(/^([\-*\u2022]|\d+\.)\s+(.*)/);
      if (bm) { flushPara(); listItems.push(bm[2]); continue; }
      para.push(s);
    }
    flushPara();

    return (
      <div key={idx} className="clinical-report-section">
        {heading ? <div className="clinical-report-section-title">{heading}</div> : null}
        {paragraphs.map((p, i) => <div key={i} className="clinical-report-paragraph">{p}</div>)}
        {listItems.length ? (
          <ul className="clinical-report-list">
            {listItems.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        ) : null}
      </div>
    );
  };

  return <div className="clinical-report-body">{blocks.map(renderBlock)}</div>;
}

// Clinical Summary Panel
const SUMMARY_MARKERS = [
  '%%RISK_ASSESSMENT%%', '%%TUMOR_GRADE%%', '%%RECOMMENDED_DIAGNOSIS%%',
  '%%TREATMENT_RECOMMENDATIONS%%', '%%CRITICAL_FINDINGS%%',
];

function parseClinicalSummary(aiText) {
  const result = {};
  for (const m of SUMMARY_MARKERS) result[m] = '';
  if (!aiText) return result;
  for (let i = 0; i < SUMMARY_MARKERS.length; i++) {
    const marker = SUMMARY_MARKERS[i];
    const start = aiText.indexOf(marker);
    if (start === -1) continue;
    const contentStart = start + marker.length;
    let nextPos = aiText.length;
    for (const other of SUMMARY_MARKERS.slice(i + 1)) {
      const pos = aiText.indexOf(other, contentStart);
      if (pos !== -1 && pos < nextPos) nextPos = pos;
    }
    result[marker] = aiText.slice(contentStart, nextPos)
      .replace(/^[-=*#]+\s*/gm, '').replace(/\*\*/g, '').trim();
  }
  return result;
}

function riskColor(text) {
  const t = (text || '').toUpperCase();
  if (t.includes('CRITICAL')) return { bg: '#dc2626', light: '#fef2f2', border: '#dc2626' };
  if (t.includes('HIGH')) return { bg: '#ea580c', light: '#fff7ed', border: '#ea580c' };
  if (t.includes('MODERATE')) return { bg: '#d97706', light: '#fffbeb', border: '#d97706' };
  return { bg: '#16a34a', light: '#f0fdf4', border: '#16a34a' };
}

function gradeColor(text) {
  const t = (text || '').toUpperCase();
  if (/ IV/.test(t) || /GRADE\s*4/.test(t)) return { bg: '#dc2626', light: '#fef2f2' };
  if (/III/.test(t) || /GRADE\s*3/.test(t)) return { bg: '#ea580c', light: '#fff7ed' };
  if (/ II/.test(t) || /GRADE\s*2/.test(t)) return { bg: '#d97706', light: '#fffbeb' };
  return { bg: '#16a34a', light: '#f0fdf4' };
}

function SummaryRow({ label, content, accentColor }) {
  const lines = (content || '').split('\n').filter(l => l.trim());
  return (
    <div className="clinical-summary-row" style={{ borderLeft: `4px solid ${accentColor}` }}>
      <div className="clinical-summary-label" style={{ color: accentColor }}>{label}</div>
      <div className="clinical-summary-content">
        {lines.map((line, i) => {
          const m = line.match(/^([\-*\u2022]|\d+\.)\s+(.*)/);
          if (m) return <div key={i} className="clinical-summary-bullet">{'\u2022'} {m[2]}</div>;
          return line.trim() ? <div key={i} className="clinical-summary-text">{line}</div> : null;
        })}
      </div>
    </div>
  );
}

function ClinicalSummaryPanel({ aiReport }) {
  const summary = parseClinicalSummary(aiReport || '');
  const hasAny = SUMMARY_MARKERS.some(m => summary[m]?.trim());
  if (!hasAny) return null;

  const risk = summary['%%RISK_ASSESSMENT%%'];
  const grade = summary['%%TUMOR_GRADE%%'];
  const diag = summary['%%RECOMMENDED_DIAGNOSIS%%'];
  const treat = summary['%%TREATMENT_RECOMMENDATIONS%%'];
  const crit = summary['%%CRITICAL_FINDINGS%%'];

  const rc = riskColor(risk);
  const gc = gradeColor(grade);

  return (
    <div className="clinical-summary-panel">
      <div className="clinical-summary-header">
        <span className="clinical-summary-header-icon">{'\ud83c\udfe5'}</span>
        CLINICAL SUMMARY {'\u2014'} FOR IMMEDIATE PHYSICIAN REVIEW
      </div>

      <div className="clinical-summary-badges">
        {risk && (
          <div className="clinical-summary-badge" style={{ background: rc.light, borderColor: rc.border }}>
            <div className="clinical-summary-badge-label">RISK LEVEL</div>
            <div className="clinical-summary-badge-value" style={{ color: rc.bg }}>
              {risk.split('\n')[0].trim()}
            </div>
          </div>
        )}
        {grade && (
          <div className="clinical-summary-badge" style={{ background: gc.light, borderColor: gc.bg }}>
            <div className="clinical-summary-badge-label">TUMOR GRADE</div>
            <div className="clinical-summary-badge-value" style={{ color: gc.bg }}>
              {grade.split('\n')[0].trim()}
            </div>
          </div>
        )}
      </div>

      {diag && <SummaryRow label={'\ud83d\udd2c RECOMMENDED DIAGNOSIS'} content={diag} accentColor="#374151" />}
      {treat && <SummaryRow label={'\ud83d\udc8a TREATMENT RECOMMENDATIONS'} content={treat} accentColor="#1e40af" />}
      {crit && <SummaryRow label={'\u26a0\ufe0f CRITICAL FINDINGS'} content={crit} accentColor="#b91c1c" />}

      <div className="clinical-summary-disclaimer">
        This AI-assisted report must be correlated clinically and interpreted alongside other investigations.
        Histopathological confirmation is required before treatment decisions.
      </div>
    </div>
  );
}
