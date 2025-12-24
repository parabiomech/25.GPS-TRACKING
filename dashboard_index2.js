// Global State
let locationData = [], accelData = [], gyroData = [];
let gpsMarkers = [];
let savedSections = [];
let activeSectionData = null;
let gpsRef = { lat: 0, lon: 0, alt: 0 }; // Reference point for 3D coords

let map, polylineGroup, mapMarker;
let isPlaying = false;
let currentIndex = 0;
let playInterval;
let processedMotionData = {};
let motionChartsInitialized = false;

// DOM Elements
const els = {
    btnPlay: document.getElementById('btnPlay'),
    btnPause: document.getElementById('btnPause'),
    slider: document.getElementById('timeSlider'),
    curTime: document.getElementById('currentTime'),
    totTime: document.getElementById('totalTime'),

    // GPS Page
    infoDate: document.getElementById('infoDate'),
    infoTime: document.getElementById('infoTime'),
    infoDevice: document.getElementById('infoDevice'),
    btnMark: document.getElementById('btnMarkEvent'),
    markerList: document.getElementById('markerList'),
    selStart: document.getElementById('gpsStartMarker'),
    selEnd: document.getElementById('gpsEndMarker'),
    secName: document.getElementById('newSectionName'),
    btnSaveSec: document.getElementById('btnSaveSection'),
    secStatsTable: document.getElementById('sectionStatsTable'),

    // Motion Page
    selSection: document.getElementById('sectionSelector'),
    secDetails: document.getElementById('sectionDetails'),

    // Analysis
    resAvgPeak: document.getElementById('resAvgPeak'),
    resMaxPeak: document.getElementById('resMaxPeak'),
    resAvgTime: document.getElementById('resAvgTime'),
    resCount: document.getElementById('resEventCount'),
    resEPM: document.getElementById('resEventsPerMin'),
    resDur: document.getElementById('resDuration')
};

// ================= FILTERING FUNCTIONS =================

function butterworthFilter(data, fs, cutoff) {
    if (!data || data.length === 0) return [];

    const sampleRate = fs || 100;
    const freq = cutoff || 6;
    const omega = 2 * Math.PI * freq / sampleRate;
    const sn = Math.sin(omega);
    const cs = Math.cos(omega);
    const alpha = sn / (2 * 0.707);

    const b0 = (1 - cs) / 2;
    const b1 = 1 - cs;
    const b2 = (1 - cs) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cs;
    const a2 = 1 - alpha;

    const A1 = a1 / a0;
    const A2 = a2 / a0;
    const B0 = b0 / a0;
    const B1 = b1 / a0;
    const B2 = b2 / a0;

    const result = new Array(data.length).fill(0);

    for (let i = 2; i < data.length; i++) {
        result[i] = B0 * data[i] + B1 * data[i - 1] + B2 * data[i - 2]
            - A1 * result[i - 1] - A2 * result[i - 2];
    }
    return result;
}

function savitzkyGolayFilter(data) {
    if (!data || data.length < 5) return data;
    const result = [...data];
    for (let i = 2; i < data.length - 2; i++) {
        result[i] = (-3 * data[i - 2] + 12 * data[i - 1] + 17 * data[i] + 12 * data[i + 1] - 3 * data[i + 2]) / 35;
    }
    return result;
}

function processFullMotionData() {
    let fs = 100;
    if (accelData.length > 1) {
        const dur = (parseInt(accelData[accelData.length - 1].time) - parseInt(accelData[0].time)) / 1e9;
        if (dur > 0) fs = accelData.length / dur;
    }

    const pipe = (raw) => {
        const floatData = raw.map(d => parseFloat(d));
        const bw = butterworthFilter(floatData, fs, 6);
        return savitzkyGolayFilter(bw);
    };

    // Accel
    const ax = pipe(accelData.map(d => d.x));
    const ay = pipe(accelData.map(d => d.y));
    const az = pipe(accelData.map(d => d.z));

    // Gyro
    const gx = pipe(gyroData.map(d => d.x * 57.3));
    const gy = pipe(gyroData.map(d => d.y * 57.3));
    const gz = pipe(gyroData.map(d => d.z * 57.3));

    // Mags
    const am = ax.map((v, i) => Math.sqrt(v * v + ay[i] * ay[i] + az[i] * az[i]));
    const gm = gx.map((v, i) => Math.sqrt(v * v + gy[i] * gy[i] + gz[i] * gz[i]));

    processedMotionData = {
        acc_x: ax, acc_y: ay, acc_z: az, acc_mag: am,
        gyro_x: gx, gyro_y: gy, gyro_z: gz, gyro_mag: gm
    };
}


// ================= DATA LOADING =================

function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    // Normalize headers: trim and lowercase
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

    return lines.slice(1).map(line => {
        // Skip empty lines
        if (!line.trim()) return null;

        const values = line.split(',');
        const obj = {};

        headers.forEach((h, i) => {
            // Remove quotes if present and trim
            let val = values[i] ? values[i].trim() : '';
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            }
            obj[h] = val;
        });

        // Alias common variations if necessary
        if (!obj.time && obj.timestamp) obj.time = obj.timestamp;
        if (!obj.latitude && obj.lat) obj.latitude = obj.lat;
        if (!obj.longitude && obj.lon) obj.longitude = obj.lon;
        if (!obj.longitude && obj.long) obj.longitude = obj.long;
        if (!obj.altitude && obj.alt) obj.altitude = obj.alt;
        if (!obj.altitude && obj.height) obj.altitude = obj.height;

        return obj;
    }).filter(x => x !== null);
}

document.getElementById('folderInput').addEventListener('change', async function (e) {
    const files = Array.from(e.target.files);
    let html = '<strong>Found Files:</strong><br>';
    let locationFile, accelFile, gyroFile, metadataFile;

    files.forEach(f => {
        const name = f.name.toLowerCase();
        if (name.includes('location')) locationFile = f;
        else if (name.includes('accelerometer') && !name.includes('uncalibrated')) accelFile = f;
        else if (name.includes('gyroscope') && !name.includes('uncalibrated')) gyroFile = f;
        else if (name.includes('metadata')) metadataFile = f;
        html += `✓ ${f.name}<br>`;
    });

    document.getElementById('fileList').innerHTML = html;

    if (!locationFile || !accelFile || !gyroFile) {
        alert('Missing required files (Location, Accelerometer, Gyroscope)');
        return;
    }

    locationData = parseCSV(await locationFile.text());
    accelData = parseCSV(await accelFile.text());
    gyroData = parseCSV(await gyroFile.text());

    if (metadataFile) {
        const txt = await metadataFile.text();
        const rows = txt.split('\n');
        if (rows.length >= 2) {
            const h = rows[0].split(','), v = rows[1].split(',');
            const m = {}; h.forEach((k, i) => m[k.trim()] = v[i]);
            if (m['device name']) els.infoDevice.textContent = m['device name'];
        }
    }

    const date = new Date(parseInt(locationData[0].time) / 1e6);
    els.infoDate.textContent = date.toLocaleDateString();
    els.infoTime.textContent = date.toLocaleTimeString();

    document.getElementById('uploadOverlay').style.display = 'none';
    document.getElementById('fileInfo').textContent = `Loaded ${locationData.length} GPS points`;

    processFullMotionData();
    initGPSPage();
    initPlaybackSystem();

    els.btnMark.onclick = addEventMarker;
    els.btnSaveSec.onclick = saveSection;
    els.selSection.onchange = (e) => loadMotionSection(e.target.value);

    document.getElementById('btnDetect').onclick = runDetection;
    document.getElementById('btnClear').onclick = clearDetection;
});

// ================= PAGE & PLAYBACK =================

function switchPage(pageId) {
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`btn-${pageId}`).classList.add('active');
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.getElementById(`${pageId}Page`).classList.add('active');

    if (pageId === 'gps') {
        setTimeout(() => { map && map.invalidateSize(); }, 100);
    } else if (pageId === 'motion') {
        if (!motionChartsInitialized) {
            initMotionPage();
            motionChartsInitialized = true;
        } else {
            Object.keys(processedMotionData).forEach(k => Plotly.Plots.resize(`chart_${k}`));
        }
    }
}

function initPlaybackSystem() {
    els.slider.max = locationData.length - 1;
    els.slider.value = 0;

    const start = parseInt(locationData[0].time);
    const end = parseInt(locationData[locationData.length - 1].time);
    els.totTime.textContent = formatTime((end - start) / 1e9);

    els.btnPlay.onclick = play;
    els.btnPause.onclick = pause;
    els.slider.oninput = () => { pause(); updateIndex(parseInt(els.slider.value)); };
}

function play() {
    isPlaying = true;
    els.btnPlay.style.display = 'none';
    els.btnPause.style.display = 'block';
    playInterval = setInterval(() => {
        if (currentIndex >= locationData.length - 1) { pause(); return; }
        updateIndex(currentIndex + 1);
    }, 100);
}

function pause() {
    isPlaying = false;
    clearInterval(playInterval);
    els.btnPlay.style.display = 'block';
    els.btnPause.style.display = 'none';
}

function updateIndex(idx) {
    currentIndex = idx;
    els.slider.value = idx;
    const start = parseInt(locationData[0].time);
    const curr = parseInt(locationData[idx].time);
    els.curTime.textContent = formatTime((curr - start) / 1e9);

    if (mapMarker) mapMarker.setLatLng([locationData[idx].latitude, locationData[idx].longitude]);

    const pt = locationData[idx];
    // FIX: Using Array of Arrays for valid restyle update of trace attributes
    // FIX: Use local coords for 3D marker
    const localPos = getLocalCoords(parseFloat(pt.latitude), parseFloat(pt.longitude), parseFloat(pt.altitude || 0));
    const marker3d = {
        x: [[localPos.x]],
        y: [[localPos.y]],
        z: [[localPos.z]]
    };
    Plotly.restyle('gps3dChart', marker3d, [1]);

    // Sync Charts
    const shape = { type: 'line', x0: idx, x1: idx, y0: 0, y1: 1, yref: 'paper', line: { color: 'red', width: 1 } };
    const activePage = document.querySelector('.page.active').id;
    if (activePage === 'gpsPage') {
        Plotly.relayout('elevationChart', { shapes: [shape] });
        Plotly.relayout('speedChart', { shapes: [shape] });
    } else if (activePage === 'motionPage') {
        let mIdx = 0;
        if (activeSectionData) {
            if (parseInt(pt.time) >= activeSectionData.timeRange[0] && parseInt(pt.time) <= activeSectionData.timeRange[1]) {
                const relTime = parseInt(pt.time) - activeSectionData.timeRange[0];
                const totalSectionTime = activeSectionData.timeRange[1] - activeSectionData.timeRange[0];
                const ratio = relTime / totalSectionTime;
                const secLen = activeSectionData.data.acc_x.length;
                mIdx = Math.floor(ratio * secLen);
                const mShape = { type: 'line', x0: mIdx, x1: mIdx, y0: 0, y1: 1, yref: 'paper', line: { color: 'red', width: 1 } };
                Object.keys(processedMotionData).forEach(k => Plotly.relayout(`chart_${k}`, { shapes: [mShape] }));
            }
        } else {
            mIdx = Math.floor(idx * (accelData.length / locationData.length));
            const mShape = { type: 'line', x0: mIdx, x1: mIdx, y0: 0, y1: 1, yref: 'paper', line: { color: 'red', width: 1 } };
            Object.keys(processedMotionData).forEach(k => Plotly.relayout(`chart_${k}`, { shapes: [mShape] }));
        }
    }
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ================= GPS PAGE LOGIC =================

function getLocalCoords(lat, lon, alt) {
    const x = (lon - gpsRef.lon) * 111320 * Math.cos(gpsRef.lat * Math.PI / 180);
    const y = (lat - gpsRef.lat) * 110574;
    const z = alt - gpsRef.alt;
    return { x, y, z };
}

function initGPSPage() {
    if (!locationData.length) return;
    map = L.map('map').setView([locationData[0].latitude, locationData[0].longitude], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Colored Polyline
    const pts = locationData;
    const stride = pts.length > 5000 ? 2 : 1;

    for (let i = 0; i < pts.length - stride; i += stride) {
        const p1 = pts[i];
        const p2 = pts[i + stride];
        const spd = parseFloat(p1.speed) * 3.6;
        let color = '#3498db';
        if (spd > 20) color = '#e67e22';
        if (spd > 40) color = '#e74c3c';

        L.polyline([[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]], { color: color, weight: 4 }).addTo(map);
    }

    mapMarker = L.circleMarker([locationData[0].latitude, locationData[0].longitude], { color: 'red', radius: 6, fillOpacity: 1 }).addTo(map);

    const yEle = locationData.map(d => parseFloat(d.altitude));
    const ySpd = locationData.map(d => parseFloat(d.speed) * 3.6);

    Plotly.newPlot('elevationChart', [{ y: yEle, type: 'scatter', fill: 'tozeroy' }], { margin: { l: 30, r: 10, t: 10, b: 20 }, height: 200 });
    Plotly.newPlot('speedChart', [{ y: ySpd, type: 'scatter', fill: 'tozeroy', line: { color: '#e67e22' } }], { margin: { l: 30, r: 10, t: 10, b: 20 }, height: 200 });

    // 3D Chart
    // Initialize Reference for Local Coordinates
    gpsRef = {
        lat: parseFloat(locationData[0].latitude),
        lon: parseFloat(locationData[0].longitude),
        alt: yEle[0]
    };

    const xRel = [], yRel = [], zRel = [];
    locationData.forEach((d, i) => {
        const res = getLocalCoords(parseFloat(d.latitude), parseFloat(d.longitude), yEle[i]);
        xRel.push(res.x);
        yRel.push(res.y);
        zRel.push(res.z);
    });

    const tracePath = {
        type: 'scatter3d', mode: 'lines',
        x: xRel, y: yRel, z: zRel,
        line: { width: 5, color: ySpd, colorscale: 'Viridis' }
    };
    const traceMarker = {
        type: 'scatter3d', mode: 'markers',
        x: [xRel[0]], y: [yRel[0]], z: [zRel[0]],
        marker: { size: 6, color: 'red' }
    };

    const layout3d = {
        margin: { t: 0, b: 0, l: 0, r: 0 },
        showlegend: false,
        scene: {
            aspectmode: 'data',
            camera: {
                eye: { x: 1.5, y: 1.5, z: 1.5 }
            }
        }
    };

    Plotly.newPlot('gps3dChart', [tracePath, traceMarker], layout3d);

    // Stats Calculation
    const dur = (parseInt(locationData[locationData.length - 1].time) - parseInt(locationData[0].time)) / 1e9 / 60;
    let dist = 0;
    let descent = 0;
    for (let i = 1; i < locationData.length; i++) {
        dist += (parseFloat(locationData[i].speed) * (parseInt(locationData[i].time) - parseInt(locationData[i - 1].time)) / 1e9);
        const dAlt = parseFloat(locationData[i].altitude) - parseFloat(locationData[i - 1].altitude);
        if (dAlt < 0) descent += Math.abs(dAlt);
    }

    document.getElementById('statDuration').textContent = dur.toFixed(1);
    document.getElementById('statDist').textContent = (dist / 1000).toFixed(2);
    const avgSpd = ySpd.reduce((a, b) => a + b, 0) / ySpd.length;
    document.getElementById('statAvgSpeed').textContent = avgSpd.toFixed(1);
    document.getElementById('statMaxSpeed').textContent = Math.max(...ySpd).toFixed(1);
    document.getElementById('statDescent').textContent = descent.toFixed(1);
}

function addEventMarker() {
    const pt = locationData[currentIndex];
    const marker = {
        id: gpsMarkers.length,
        index: currentIndex,
        time: pt.time,
        label: `Marker (${els.curTime.textContent})`
    };
    gpsMarkers.push(marker);
    renderMarkerList();
}

function deleteMarker(idx) {
    gpsMarkers = gpsMarkers.filter(m => m.id !== idx);
    renderMarkerList();
}

function renderMarkerList() {
    els.markerList.innerHTML = '';
    els.selStart.innerHTML = '<option value="">Start</option>';
    els.selEnd.innerHTML = '<option value="">End</option>';

    gpsMarkers.forEach(m => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.padding = '2px 0';
        div.innerHTML = `<span>📍 ${m.label}</span>`;

        const btnDel = document.createElement('span');
        btnDel.textContent = '❌';
        btnDel.style.cursor = 'pointer';
        btnDel.onclick = () => deleteMarker(m.id);
        div.appendChild(btnDel);

        els.markerList.appendChild(div);

        els.selStart.appendChild(new Option(m.label, m.id));
        els.selEnd.appendChild(new Option(m.label, m.id));
    });
}

// ================= MOTION ANALYSIS =================

function saveSection() {
    const sId = parseInt(els.selStart.value);
    const eId = parseInt(els.selEnd.value);
    const name = els.secName.value || `Section ${savedSections.length + 1}`;

    const m1 = gpsMarkers.find(m => m.id === sId);
    const m2 = gpsMarkers.find(m => m.id === eId);

    if (!m1 || !m2 || m1.index >= m2.index) { alert("Invalid Selection"); return; }

    // Slice Data
    const tStart = parseInt(m1.time);
    const tEnd = parseInt(m2.time);
    const aStart = accelData.findIndex(d => parseInt(d.time) >= tStart);
    let aEnd = accelData.findIndex(d => parseInt(d.time) > tEnd);
    if (aEnd === -1) aEnd = accelData.length;

    const sliceObj = {};
    Object.keys(processedMotionData).forEach(k => {
        sliceObj[k] = processedMotionData[k].slice(aStart, aEnd);
    });

    const section = {
        id: `sec_${savedSections.length}`,
        name: name,
        timeRange: [tStart, tEnd],
        gpsRange: [m1.index, m2.index],
        motionRange: [aStart, aEnd],
        data: sliceObj,
        duration: (tEnd - tStart) / 1e9
    };

    savedSections.push(section);
    els.selSection.appendChild(new Option(name, section.id));

    // Stats
    let secDist = 0;
    let secDescent = 0;
    const speeds = [];

    for (let i = m1.index + 1; i <= m2.index; i++) {
        const dTime = (parseInt(locationData[i].time) - parseInt(locationData[i - 1].time)) / 1e9;
        const spd = parseFloat(locationData[i].speed);
        speeds.push(spd * 3.6);
        secDist += spd * dTime;

        const dAlt = parseFloat(locationData[i].altitude) - parseFloat(locationData[i - 1].altitude);
        if (dAlt < 0) secDescent += Math.abs(dAlt);
    }

    const maxSpd = speeds.length ? Math.max(...speeds) : 0;
    const avgSpd = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

    if (savedSections.length === 1) els.secStatsTable.innerHTML = '';

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${name}</td>
        <td>${section.duration.toFixed(1)}</td>
        <td>${secDist.toFixed(1)}</td>
        <td>${avgSpd.toFixed(1)}</td>
        <td>${maxSpd.toFixed(1)}</td>
        <td>${secDescent.toFixed(1)}</td>
    `;
    els.secStatsTable.appendChild(row);

    alert(`Section "${name}" saved! Stats added.`);
}

function loadMotionSection(val) {
    clearDetection();
    if (val === 'full') {
        activeSectionData = null;
        els.secDetails.textContent = `Displaying all data`;
        loadCharts(processedMotionData);
    } else {
        const sec = savedSections.find(s => s.id === val);
        activeSectionData = sec;
        els.secDetails.textContent = `Section: ${sec.name} | Duration: ${sec.duration.toFixed(1)}s`;
        loadCharts(sec.data);
    }
}

function loadCharts(data) {
    Object.keys(data).forEach(k => {
        Plotly.newPlot(`chart_${k}`, [{
            y: data[k], type: 'scatter', mode: 'lines', line: { width: 1.5 }
        }], {
            margin: { l: 30, r: 10, t: 30, b: 20 }, height: 200, yaxis: { title: k }
        });
    });
}

function runDetection() {
    const key = document.getElementById('targetVar').value;
    const thresh = parseFloat(document.getElementById('algoThreshold').value);
    const win = parseInt(document.getElementById('algoWindow').value);
    const dir = document.getElementById('detectDir').value;

    const dataObj = activeSectionData ? activeSectionData.data : processedMotionData;
    const series = dataObj[key];

    const peaks = [];
    for (let i = 0; i < series.length; i += win) {
        let maxV = -Infinity, pI = -1;
        let minV = Infinity, mI = -1;

        for (let j = i; j < Math.min(i + win, series.length); j++) {
            if (series[j] > maxV) { maxV = series[j]; pI = j; }
            if (series[j] < minV) { minV = series[j]; mI = j; }
        }

        if (dir === 'pos' || dir === 'abs') {
            if (maxV > thresh) peaks.push({ i: pI, v: maxV });
        }
        if (dir === 'neg' || dir === 'abs') {
            if (minV < -thresh) peaks.push({ i: mI, v: minV });
        }
    }

    const trace0 = { y: series, type: 'scatter', mode: 'lines' };
    const trace1 = {
        x: peaks.map(p => p.i), y: peaks.map(p => p.v),
        type: 'scatter', mode: 'markers', marker: { color: 'red', size: 8 }
    };

    Plotly.react(`chart_${key}`, [trace0, trace1], {
        margin: { l: 30, r: 10, t: 30, b: 20 }, height: 200, yaxis: { title: key }
    });

    calculateStats(peaks, activeSectionData ? activeSectionData.duration : (locationData.length > 0 ? (parseInt(locationData[locationData.length - 1].time) - parseInt(locationData[0].time)) / 1e9 : 0));
}

function calculateStats(peaks, totalDuration) {
    if (peaks.length === 0) {
        els.resAvgPeak.textContent = "-";
        els.resMaxPeak.textContent = "-";
        els.resAvgTime.textContent = "-";
        els.resCount.textContent = "0";
        els.resEPM.textContent = "0";
        return;
    }

    const absPeaks = peaks.map(p => Math.abs(p.v));
    const avgVal = absPeaks.reduce((a, b) => a + b, 0) / peaks.length;
    const maxVal = Math.max(...absPeaks);

    let totalSamples = activeSectionData ? activeSectionData.motionRange[1] - activeSectionData.motionRange[0] : accelData.length;
    let dt = totalDuration / totalSamples;
    if (!dt) dt = 0.01;

    let intervals = [];
    peaks.sort((a, b) => a.i - b.i);
    for (let i = 1; i < peaks.length; i++) {
        intervals.push((peaks[i].i - peaks[i - 1].i) * dt);
    }

    const avgCycle = intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    const count = peaks.length;
    const epm = (count / totalDuration) * 60;

    els.resAvgPeak.textContent = avgVal.toFixed(2);
    els.resMaxPeak.textContent = maxVal.toFixed(2);
    els.resAvgTime.textContent = avgCycle.toFixed(3);
    els.resCount.textContent = count;
    els.resEPM.textContent = epm.toFixed(1);
    els.resDur.textContent = totalDuration.toFixed(1);
}

function clearDetection() {
    const dataObj = activeSectionData ? activeSectionData.data : processedMotionData;
    loadCharts(dataObj);
    [els.resAvgPeak, els.resMaxPeak, els.resAvgTime, els.resCount, els.resEPM].forEach(e => e.textContent = "-");
}

function initMotionPage() {
    loadCharts(processedMotionData);
}
