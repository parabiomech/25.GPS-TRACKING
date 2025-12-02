// 전역 데이터 저장소
let locationData = [], accelData = [], gyroData = [], orientData = [], metadataObj = {};
let map, map2, marker, marker2, polyline, polyline2;
let isPlaying = false, isPlaying2 = false;
let currentIndex = 0, currentIndex2 = 0;
let playInterval, playInterval2;
let eventMarkers = [];
let savedSections = [];
let detectedTurns = [];
let currentSection = null;

// CSV 파싱 함수
function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim());
        return obj;
    });
}

// 폴더 업로드 핸들러
document.getElementById('folderInput').addEventListener('change', async function(e) {
    const files = Array.from(e.target.files);
    let fileListHTML = '<div style="margin-top:20px;"><strong>발견한 파일:</strong></div>';
    let locationFile, accelFile, gyroFile, orientFile, metadataFile;
    
    files.forEach(f => {
        const name = f.name.toLowerCase();
        if (name.includes('location')) { locationFile = f; fileListHTML += `<div class="file-item">✓ ${f.name}</div>`; }
        else if (name.includes('accelerometer') && !name.includes('uncalibrated')) { accelFile = f; fileListHTML += `<div class="file-item">✓ ${f.name}</div>`; }
        else if (name.includes('gyroscope') && !name.includes('uncalibrated')) { gyroFile = f; fileListHTML += `<div class="file-item">✓ ${f.name}</div>`; }
        else if (name.includes('orientation')) { orientFile = f; fileListHTML += `<div class="file-item">✓ ${f.name}</div>`; }
        else if (name.includes('metadata')) { metadataFile = f; fileListHTML += `<div class="file-item">✓ ${f.name}</div>`; }
    });
    
    document.getElementById('fileList').innerHTML = fileListHTML;
    
    if (!locationFile || !accelFile || !gyroFile) {
        alert('필수 파일이 부족합니다 (Location, Accelerometer, Gyroscope 필요)');
        return;
    }
    
    // 파일 로드
    locationData = parseCSV(await locationFile.text());
    accelData = parseCSV(await accelFile.text());
    gyroData = parseCSV(await gyroFile.text());
    if (orientFile) orientData = parseCSV(await orientFile.text());
    if (metadataFile) {
        const metaText = await metadataFile.text();
        const metaLines = metaText.trim().split('\n');
        if (metaLines.length >= 2) {
            const headers = metaLines[0].split(',').map(h => h.trim());
            const values = metaLines[1].split(',').map(v => v.trim());
            headers.forEach((h, i) => {
                metadataObj[h] = values[i] || '';
            });
        }
    }
    
    // UI 전환
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('tabNav').style.display = 'flex';
    document.getElementById('gpsPage').classList.add('active');
    
    // GPS 페이지 초기화
    initGPSPage();
});

// GPS 페이지 초기화
function initGPSPage() {
    initMap();
    initMetadataDisplay();
    initPlaybackControls();
    initEventMarkers();
    createSpeedChart();
    createElevationChart();
    create3DGPSChart();
    updateStats();
}

// 맵 초기화
function initMap() {
    const firstPoint = locationData[0];
    const lat = parseFloat(firstPoint.latitude);
    const lng = parseFloat(firstPoint.longitude);
    
    map = L.map('map').setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    const coords = locationData.map(d => [parseFloat(d.latitude), parseFloat(d.longitude)]);
    
    const segments = [];
    for (let i = 0; i < coords.length - 1; i++) {
        const speed = parseFloat(locationData[i].speed || 0);
        const color = speed > 10 ? '#e74c3c' : speed > 5 ? '#f39c12' : '#3498db';
        segments.push(L.polyline([coords[i], coords[i + 1]], { color, weight: 4 }).addTo(map));
    }
    polyline = L.layerGroup(segments).addTo(map);
    
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on('dragend', function() {
        const pos = marker.getLatLng();
        let nearestIdx = 0, minDist = Infinity;
        coords.forEach((c, idx) => {
            const dist = Math.sqrt(Math.pow(c[0] - pos.lat, 2) + Math.pow(c[1] - pos.lng, 2));
            if (dist < minDist) { minDist = dist; nearestIdx = idx; }
        });
        currentIndex = nearestIdx;
        updateMarkerPosition(currentIndex);
        updateTimeDisplay();
    });
}

// 메타데이터 표시
function initMetadataDisplay() {
    document.getElementById('deviceName').textContent = metadataObj['device name'] || '알 수 없음';
    
    const recordingTime = metadataObj['recording time'] || '';
    const timezone = metadataObj['recording timezone'] || '';
    
    if (recordingTime) {
        const parts = recordingTime.split('_');
        if (parts.length === 2) {
            document.getElementById('measureDate').textContent = parts[0];
            document.getElementById('measureTime').textContent = parts[1].replace(/-/g, ':');
        }
    } else {
        const timestamp = parseInt(locationData[0].time);
        const date = new Date(timestamp / 1e6);
        document.getElementById('measureDate').textContent = date.toLocaleDateString('ko-KR');
        document.getElementById('measureTime').textContent = date.toLocaleTimeString('ko-KR');
    }
    
    const lat = parseFloat(locationData[0].latitude).toFixed(6);
    const lng = parseFloat(locationData[0].longitude).toFixed(6);
    document.getElementById('coordinates').textContent = `${lat}, ${lng}`;
    document.getElementById('location').textContent = timezone || '-';
    
    const avgAlt = locationData.reduce((sum, d) => sum + parseFloat(d.altitude || 0), 0) / locationData.length;
    document.getElementById('avgAltitude').textContent = avgAlt.toFixed(1) + ' m';
}

// 통계 업데이트
function updateStats() {
    const firstTime = parseInt(locationData[0].time);
    const lastTime = parseInt(locationData[locationData.length - 1].time);
    const duration = (lastTime - firstTime) / 1e9 / 60;
    document.getElementById('workoutTime').textContent = duration.toFixed(1);
    
    const altitudes = locationData.map(d => parseFloat(d.altitude || 0));
    const elevDiff = Math.max(...altitudes) - Math.min(...altitudes);
    document.getElementById('elevationDiff').textContent = elevDiff.toFixed(1);
    
    const avgSpd = locationData.reduce((s, d) => s + parseFloat(d.speed || 0), 0) / locationData.length;
    document.getElementById('avgSpeed').textContent = avgSpd.toFixed(2);
    
    const maxSpd = Math.max(...locationData.map(d => parseFloat(d.speed || 0)));
    document.getElementById('maxSpeed').textContent = maxSpd.toFixed(2);
}

// 속도 차트
function createSpeedChart() {
    const times = locationData.map((_, i) => i);
    const speeds = locationData.map(d => parseFloat(d.speed || 0));
    
    Plotly.newPlot('speedChart', [{
        x: times,
        y: speeds,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#e74c3c', width: 2 },
        fill: 'tozeroy',
        fillcolor: 'rgba(231, 76, 60, 0.2)'
    }], {
        margin: { l: 40, r: 20, t: 10, b: 30 },
        xaxis: { title: 'Time Index' },
        yaxis: { title: 'Speed (m/s)' },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: 'white'
    }, { responsive: true });
}

// 고도 차트
function createElevationChart() {
    const times = locationData.map((_, i) => i);
    const elevations = locationData.map(d => parseFloat(d.altitude || 0));
    
    Plotly.newPlot('elevationChart', [{
        x: times,
        y: elevations,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#3498db', width: 2 },
        fill: 'tozeroy',
        fillcolor: 'rgba(52, 152, 219, 0.2)'
    }], {
        margin: { l: 40, r: 20, t: 10, b: 30 },
        xaxis: { title: 'Time Index' },
        yaxis: { title: 'Altitude (m)' },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: 'white'
    }, { responsive: true });
}

// 3D GPS 경로 차트
function create3DGPSChart() {
    const lats = locationData.map(d => parseFloat(d.latitude));
    const lngs = locationData.map(d => parseFloat(d.longitude));
    const alts = locationData.map(d => parseFloat(d.altitude || 0));
    const speeds = locationData.map(d => parseFloat(d.speed || 0));
    
    Plotly.newPlot('gps3dChart', [{
        type: 'scatter3d',
        mode: 'lines',
        x: lngs,
        y: lats,
        z: alts,
        line: {
            color: speeds,
            colorscale: [
                [0, '#3498db'],
                [0.5, '#f39c12'],
                [1, '#e74c3c']
            ],
            width: 6,
            colorbar: {
                title: 'Speed<br>(m/s)',
                thickness: 15,
                len: 0.7
            }
        },
        hovertemplate: '<b>Lat:</b> %{y:.6f}<br><b>Lng:</b> %{x:.6f}<br><b>Alt:</b> %{z:.1f}m<extra></extra>'
    }], {
        margin: { l: 0, r: 0, t: 0, b: 0 },
        scene: {
            xaxis: { title: 'Longitude' },
            yaxis: { title: 'Latitude' },
            zaxis: { title: 'Altitude (m)' },
            camera: {
                eye: { x: 1.5, y: 1.5, z: 1.2 }
            }
        },
        paper_bgcolor: 'white'
    }, { responsive: true });
}

// 재생 컨트롤
function initPlaybackControls() {
    document.getElementById('playBtn').onclick = startPlayback;
    document.getElementById('pauseBtn').onclick = pausePlayback;
    document.getElementById('resetBtn').onclick = resetPlayback;
    
    document.getElementById('progressBar').onclick = function(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        currentIndex = Math.floor(percent * locationData.length);
        updateMarkerPosition(currentIndex);
        updateTimeDisplay();
    };
}

function startPlayback() {
    isPlaying = true;
    document.getElementById('playBtn').disabled = true;
    document.getElementById('pauseBtn').disabled = false;
    
    playInterval = setInterval(() => {
        if (currentIndex >= locationData.length - 1) {
            pausePlayback();
            return;
        }
        currentIndex++;
        updateMarkerPosition(currentIndex);
        updateTimeDisplay();
    }, 100);
}

function pausePlayback() {
    isPlaying = false;
    clearInterval(playInterval);
    document.getElementById('playBtn').disabled = false;
    document.getElementById('pauseBtn').disabled = true;
}

function resetPlayback() {
    pausePlayback();
    currentIndex = 0;
    updateMarkerPosition(0);
    updateTimeDisplay();
}

function updateMarkerPosition(idx) {
    const point = locationData[idx];
    const lat = parseFloat(point.latitude);
    const lng = parseFloat(point.longitude);
    marker.setLatLng([lat, lng]);
    
    const percent = (idx / locationData.length) * 100;
    document.getElementById('progressFill').style.width = percent + '%';
    
    // GPS 차트들에 시점 마커 추가 (3D, 속도, 고도, 지도)
    updateGPSChartMarkers(idx);
}

function updateTimeDisplay() {
    const firstTime = parseInt(locationData[0].time) / 1e9;
    const currentTime = parseInt(locationData[currentIndex].time) / 1e9;
    const lastTime = parseInt(locationData[locationData.length - 1].time) / 1e9;
    
    const elapsed = Math.floor(currentTime - firstTime);
    const total = Math.floor(lastTime - firstTime);
    
    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    
    document.getElementById('timeDisplay').textContent = `${formatTime(elapsed)} / ${formatTime(total)}`;
}

// GPS 차트들에 현재 시점 마커 표시 (3D, 속도, 고도)
function updateGPSChartMarkers(idx) {
    // 속도 차트 마커
    const speedShapes = [{
        type: 'line',
        x0: idx, x1: idx,
        y0: 0, y1: 1,
        yref: 'paper',
        line: { color: '#e74c3c', width: 2, dash: 'dot' }
    }];
    Plotly.relayout('speedChart', { shapes: speedShapes });
    
    // 고도 차트 마커
    const elevShapes = [{
        type: 'line',
        x0: idx, x1: idx,
        y0: 0, y1: 1,
        yref: 'paper',
        line: { color: '#3498db', width: 2, dash: 'dot' }
    }];
    Plotly.relayout('elevationChart', { shapes: elevShapes });
    
    // 3D 차트 현재 위치 마커
    const currentLat = parseFloat(locationData[idx].latitude);
    const currentLng = parseFloat(locationData[idx].longitude);
    const currentAlt = parseFloat(locationData[idx].altitude || 0);
    
    const lats = locationData.map(d => parseFloat(d.latitude));
    const lngs = locationData.map(d => parseFloat(d.longitude));
    const alts = locationData.map(d => parseFloat(d.altitude || 0));
    const speeds = locationData.map(d => parseFloat(d.speed || 0));
    
    Plotly.react('gps3dChart', [
        {
            type: 'scatter3d',
            mode: 'lines',
            x: lngs,
            y: lats,
            z: alts,
            line: {
                color: speeds,
                colorscale: [
                    [0, '#3498db'],
                    [0.5, '#f39c12'],
                    [1, '#e74c3c']
                ],
                width: 6,
                colorbar: {
                    title: 'Speed<br>(m/s)',
                    thickness: 15,
                    len: 0.7
                }
            },
            hovertemplate: '<b>Lat:</b> %{y:.6f}<br><b>Lng:</b> %{x:.6f}<br><b>Alt:</b> %{z:.1f}m<extra></extra>'
        },
        {
            type: 'scatter3d',
            mode: 'markers',
            x: [currentLng],
            y: [currentLat],
            z: [currentAlt],
            marker: {
                size: 8,
                color: '#e74c3c',
                symbol: 'circle',
                line: { color: 'white', width: 2 }
            },
            hovertemplate: '<b>Current Position</b><br><b>Lat:</b> %{y:.6f}<br><b>Lng:</b> %{x:.6f}<br><b>Alt:</b> %{z:.1f}m<extra></extra>'
        }
    ]);
}

// 이벤트 마커
function initEventMarkers() {
    document.getElementById('addEventBtn').onclick = function() {
        const time = locationData[currentIndex].time;
        const lat = parseFloat(locationData[currentIndex].latitude);
        const lng = parseFloat(locationData[currentIndex].longitude);
        
        eventMarkers.push({ time, index: currentIndex, lat, lng });
        updateEventList();
    };
    
    document.getElementById('sectionStart').onchange = updateSectionPreview;
    document.getElementById('sectionEnd').onchange = updateSectionPreview;
    document.getElementById('saveSectionBtn').onclick = saveSection;
}

function updateEventList() {
    const list = document.getElementById('eventList');
    const startSelect = document.getElementById('sectionStart');
    const endSelect = document.getElementById('sectionEnd');
    
    if (eventMarkers.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 20px; font-size: 12px;">기록된 시점이 없습니다</div>';
        startSelect.innerHTML = '<option value="">시작 시점</option>';
        endSelect.innerHTML = '<option value="">종료 시점</option>';
        return;
    }
    
    list.innerHTML = '';
    startSelect.innerHTML = '<option value="">시작 시점</option>';
    endSelect.innerHTML = '<option value="">종료 시점</option>';
    
    eventMarkers.forEach((evt, idx) => {
        const date = new Date(parseInt(evt.time) / 1e6);
        const timeStr = date.toLocaleTimeString('ko-KR');
        
        const div = document.createElement('div');
        div.className = 'event-item';
        div.innerHTML = `
            <span class="event-time">🚩 ${timeStr}</span>
            <span class="event-delete" onclick="deleteEvent(${idx})">×</span>
        `;
        div.onclick = function(e) {
            if (!e.target.classList.contains('event-delete')) {
                currentIndex = evt.index;
                updateMarkerPosition(currentIndex);
                updateTimeDisplay();
            }
        };
        list.appendChild(div);
        
        const option1 = document.createElement('option');
        option1.value = idx;
        option1.textContent = `시점 ${idx + 1} (${timeStr})`;
        startSelect.appendChild(option1);
        
        const option2 = document.createElement('option');
        option2.value = idx;
        option2.textContent = `시점 ${idx + 1} (${timeStr})`;
        endSelect.appendChild(option2);
    });
}

function deleteEvent(idx) {
    eventMarkers.splice(idx, 1);
    updateEventList();
}

function updateSectionPreview() {
    const startIdx = document.getElementById('sectionStart').value;
    const endIdx = document.getElementById('sectionEnd').value;
    
    if (!startIdx || !endIdx || parseInt(startIdx) >= parseInt(endIdx)) {
        document.getElementById('sectionInfo').style.display = 'none';
        return;
    }
    
    const startEvent = eventMarkers[parseInt(startIdx)];
    const endEvent = eventMarkers[parseInt(endIdx)];
    const section = locationData.slice(startEvent.index, endEvent.index + 1);
    
    const duration = (parseInt(endEvent.time) - parseInt(startEvent.time)) / 1e9;
    const elevs = section.map(d => parseFloat(d.altitude || 0));
    const elevDiff = Math.max(...elevs) - Math.min(...elevs);
    const avgSpd = section.reduce((s, d) => s + parseFloat(d.speed || 0), 0) / section.length;
    const maxSpd = Math.max(...section.map(d => parseFloat(d.speed || 0)));
    
    document.getElementById('sectionTime').textContent = duration.toFixed(1) + ' s';
    document.getElementById('sectionElevation').textContent = elevDiff.toFixed(1) + ' m';
    document.getElementById('sectionAvgSpeed').textContent = avgSpd.toFixed(2) + ' m/s';
    document.getElementById('sectionMaxSpeed').textContent = maxSpd.toFixed(2) + ' m/s';
    document.getElementById('sectionInfo').style.display = 'block';
}

function saveSection() {
    const startIdx = parseInt(document.getElementById('sectionStart').value);
    const endIdx = parseInt(document.getElementById('sectionEnd').value);
    
    if (isNaN(startIdx) || isNaN(endIdx) || startIdx >= endIdx) {
        alert('유효한 시작/종료 시점을 선택하세요');
        return;
    }
    
    const startEvent = eventMarkers[startIdx];
    const endEvent = eventMarkers[endIdx];
    const section = {
        name: `구간 ${savedSections.length + 1}`,
        startTime: startEvent.time,
        endTime: endEvent.time,
        startIndex: startEvent.index,
        endIndex: endEvent.index,
        locationData: locationData.slice(startEvent.index, endEvent.index + 1),
        accelData: accelData.filter(d => parseInt(d.time) >= parseInt(startEvent.time) && parseInt(d.time) <= parseInt(endEvent.time)),
        gyroData: gyroData.filter(d => parseInt(d.time) >= parseInt(startEvent.time) && parseInt(d.time) <= parseInt(endEvent.time)),
        orientData: orientData.filter(d => parseInt(d.time) >= parseInt(startEvent.time) && parseInt(d.time) <= parseInt(endEvent.time))
    };
    
    savedSections.push(section);
    alert(`주행 구간이 저장되었습니다 (${section.name})`);
    updateSectionList();
}

function updateSectionList() {
    const list = document.getElementById('sectionList');
    if (savedSections.length === 0) {
        list.innerHTML = '<div style="color: #6c757d; font-size: 12px;">GPS 페이지에서 구간을 저장하세요</div>';
        return;
    }
    
    list.innerHTML = '';
    savedSections.forEach((sec, idx) => {
        const chip = document.createElement('div');
        chip.className = 'section-chip';
        if (currentSection === idx) chip.classList.add('active');
        chip.textContent = sec.name;
        chip.onclick = () => loadSection(idx);
        list.appendChild(chip);
    });
}

function loadSection(idx) {
    currentSection = idx;
    updateSectionList();
    
    const section = savedSections[idx];
    
    // Motion 페이지 초기화
    if (!map2) initMotionPage();
    
    // 맵 업데이트
    if (polyline2) map2.removeLayer(polyline2);
    if (marker2) map2.removeLayer(marker2);
    
    const coords = section.locationData.map(d => [parseFloat(d.latitude), parseFloat(d.longitude)]);
    const segments = [];
    for (let i = 0; i < coords.length - 1; i++) {
        const speed = parseFloat(section.locationData[i].speed || 0);
        const color = speed > 10 ? '#e74c3c' : speed > 5 ? '#f39c12' : '#3498db';
        segments.push(L.polyline([coords[i], coords[i + 1]], { color, weight: 4 }));
    }
    polyline2 = L.layerGroup(segments).addTo(map2);
    marker2 = L.marker(coords[0]).addTo(map2);
    map2.setView(coords[0], 14);
    
    // 차트 업데이트
    createAccelChart(section.accelData);
    createGyroChart(section.gyroData);
    createOrientChart(section.orientData);
    createAccelFilterChart(section.accelData);
    createGyroFilterChart(section.gyroData);
    
    currentIndex2 = 0;
    updateMotionStats(section);
}

// 탭 전환
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    
    if (tab === 'gps') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('gpsPage').classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('motionPage').classList.add('active');
        if (!map2) initMotionPage();
    }
}

// Motion 페이지 초기화
function initMotionPage() {
    const firstPoint = locationData[0];
    const lat = parseFloat(firstPoint.latitude);
    const lng = parseFloat(firstPoint.longitude);
    
    map2 = L.map('map2').setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map2);
    
    updateSectionList();
    initMotionPlayback();
    createAccelChart(accelData);
    createGyroChart(gyroData);
    createOrientChart(orientData);
    createAccelFilterChart(accelData);
    createGyroFilterChart(gyroData);
    initTurnDetection();
}

// Butterworth 저역 통과 필터 (간소화 버전)
function butterworthFilter(data, cutoffFreq = 0.1) {
    const result = [...data];
    const alpha = cutoffFreq;
    
    for (let i = 1; i < result.length; i++) {
        result[i] = alpha * data[i] + (1 - alpha) * result[i - 1];
    }
    
    return result;
}

// Savitzky-Golay 필터 (5-point quadratic/cubic smoothing)
function savitzkyGolayFilter(data, windowSize = 5) {
    const result = [];
    const halfWindow = Math.floor(windowSize / 2);
    
    // 5-point smoothing coefficients (quadratic)
    const coeffs = [-3, 12, 17, 12, -3];
    const norm = 35;
    
    for (let i = 0; i < data.length; i++) {
        if (i < halfWindow || i >= data.length - halfWindow) {
            result.push(data[i]); // 경계는 원본 사용
        } else {
            let sum = 0;
            for (let j = -halfWindow; j <= halfWindow; j++) {
                sum += data[i + j] * coeffs[j + halfWindow];
            }
            result.push(sum / norm);
        }
    }
    
    return result;
}

// 가속도 필터링 차트
function createAccelFilterChart(data) {
    if (!data || data.length === 0) {
        document.getElementById('accelFilterChart').innerHTML = '<div style="text-align:center;padding:50px;color:#6c757d;">데이터 없음</div>';
        return;
    }
    
    const times = data.map((_, i) => i);
    const x = data.map(d => parseFloat(d.x || 0));
    const y = data.map(d => parseFloat(d.y || 0));
    const z = data.map(d => parseFloat(d.z || 0));
    const mag = data.map(d => Math.sqrt(parseFloat(d.x || 0) ** 2 + parseFloat(d.y || 0) ** 2 + parseFloat(d.z || 0) ** 2));
    
    // Butterworth 필터 적용
    const magButter = butterworthFilter(mag, 0.15);
    
    // Savitzky-Golay 필터 적용
    const magSG = savitzkyGolayFilter(mag, 9);
    
    Plotly.newPlot('accelFilterChart', [
        { x: times, y: mag, name: 'Original', type: 'scatter', mode: 'lines', line: { color: '#95a5a6', width: 1 }, opacity: 0.5 },
        { x: times, y: magButter, name: 'Butterworth', type: 'scatter', mode: 'lines', line: { color: '#3498db', width: 2 } },
        { x: times, y: magSG, name: 'Savitzky-Golay', type: 'scatter', mode: 'lines', line: { color: '#e74c3c', width: 2 } }
    ], {
        margin: { l: 40, r: 20, t: 10, b: 30 },
        xaxis: { title: 'Sample Index' },
        yaxis: { title: 'Acceleration Magnitude (m/s²)' },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: 'white',
        legend: { x: 0.01, y: 0.99 }
    }, { responsive: true });
}

// 각속도 필터링 차트
function createGyroFilterChart(data) {
    if (!data || data.length === 0) {
        document.getElementById('gyroFilterChart').innerHTML = '<div style="text-align:center;padding:50px;color:#6c757d;">데이터 없음</div>';
        return;
    }
    
    const times = data.map((_, i) => i);
    const radToDeg = (rad) => rad * (180 / Math.PI);
    const mag = data.map(d => {
        const xRad = parseFloat(d.x || 0);
        const yRad = parseFloat(d.y || 0);
        const zRad = parseFloat(d.z || 0);
        return radToDeg(Math.sqrt(xRad ** 2 + yRad ** 2 + zRad ** 2));
    });
    
    // Butterworth 필터 적용
    const magButter = butterworthFilter(mag, 0.15);
    
    // Savitzky-Golay 필터 적용
    const magSG = savitzkyGolayFilter(mag, 9);
    
    Plotly.newPlot('gyroFilterChart', [
        { x: times, y: mag, name: 'Original', type: 'scatter', mode: 'lines', line: { color: '#95a5a6', width: 1 }, opacity: 0.5 },
        { x: times, y: magButter, name: 'Butterworth', type: 'scatter', mode: 'lines', line: { color: '#3498db', width: 2 } },
        { x: times, y: magSG, name: 'Savitzky-Golay', type: 'scatter', mode: 'lines', line: { color: '#e74c3c', width: 2 } }
    ], {
        margin: { l: 40, r: 20, t: 10, b: 30 },
        xaxis: { title: 'Sample Index' },
        yaxis: { title: 'Angular Velocity Magnitude (°/s)' },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: 'white',
        legend: { x: 0.01, y: 0.99 }
    }, { responsive: true });
}

function initMotionPlayback() {
    document.getElementById('playBtn2').onclick = startMotionPlayback;
    document.getElementById('pauseBtn2').onclick = pauseMotionPlayback;
    document.getElementById('resetBtn2').onclick = resetMotionPlayback;
    
    document.getElementById('progressBar2').onclick = function(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const data = currentSection !== null ? savedSections[currentSection].locationData : locationData;
        currentIndex2 = Math.floor(percent * data.length);
        updateMotionMarkerPosition(currentIndex2);
    };
}

function startMotionPlayback() {
    isPlaying2 = true;
    document.getElementById('playBtn2').disabled = true;
    document.getElementById('pauseBtn2').disabled = false;
    
    const data = currentSection !== null ? savedSections[currentSection].locationData : locationData;
    
    playInterval2 = setInterval(() => {
        if (currentIndex2 >= data.length - 1) {
            pauseMotionPlayback();
            return;
        }
        currentIndex2++;
        updateMotionMarkerPosition(currentIndex2);
    }, 100);
}

function pauseMotionPlayback() {
    isPlaying2 = false;
    clearInterval(playInterval2);
    document.getElementById('playBtn2').disabled = false;
    document.getElementById('pauseBtn2').disabled = true;
}

function resetMotionPlayback() {
    pauseMotionPlayback();
    currentIndex2 = 0;
    updateMotionMarkerPosition(0);
}

function updateMotionMarkerPosition(idx) {
    const data = currentSection !== null ? savedSections[currentSection].locationData : locationData;
    if (!data[idx]) return;
    
    const point = data[idx];
    const lat = parseFloat(point.latitude);
    const lng = parseFloat(point.longitude);
    if (marker2) marker2.setLatLng([lat, lng]);
    
    const percent = (idx / data.length) * 100;
    document.getElementById('progressFill2').style.width = percent + '%';
    
    const firstTime = parseInt(data[0].time) / 1e9;
    const currentTime = parseInt(data[idx].time) / 1e9;
    const lastTime = parseInt(data[data.length - 1].time) / 1e9;
    
    const elapsed = Math.floor(currentTime - firstTime);
    const total = Math.floor(lastTime - firstTime);
    
    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    
    document.getElementById('timeDisplay2').textContent = `${formatTime(elapsed)} / ${formatTime(total)}`;
    
    // 차트에 수직선 표시
    updateChartMarker(idx);
}

function updateChartMarker(idx) {
    const shapes = [{
        type: 'line',
        x0: idx, x1: idx,
        y0: 0, y1: 1,
        yref: 'paper',
        line: { color: '#e74c3c', width: 2, dash: 'dot' }
    }];
    
    Plotly.relayout('accelChart', { shapes });
    Plotly.relayout('gyroChart', { shapes });
    Plotly.relayout('orientChart', { shapes });
    Plotly.relayout('accelFilterChart', { shapes });
    Plotly.relayout('gyroFilterChart', { shapes });
}

// 가속도 차트
function createAccelChart(data) {
    if (!data || data.length === 0) {
        document.getElementById('accelChart').innerHTML = '<div style="text-align:center;padding:50px;color:#6c757d;">데이터 없음</div>';
        return;
    }
    
    const times = data.map((_, i) => i);
    const x = data.map(d => parseFloat(d.x || 0));
    const y = data.map(d => parseFloat(d.y || 0));
    const z = data.map(d => parseFloat(d.z || 0));
    const mag = data.map(d => Math.sqrt(parseFloat(d.x || 0) ** 2 + parseFloat(d.y || 0) ** 2 + parseFloat(d.z || 0) ** 2));
    
    Plotly.newPlot('accelChart', [
        { x: times, y: x, name: 'X', type: 'scatter', mode: 'lines', line: { color: '#e74c3c', width: 1 } },
        { x: times, y: y, name: 'Y', type: 'scatter', mode: 'lines', line: { color: '#3498db', width: 1 } },
        { x: times, y: z, name: 'Z', type: 'scatter', mode: 'lines', line: { color: '#2ecc71', width: 1 } },
        { x: times, y: mag, name: 'Magnitude', type: 'scatter', mode: 'lines', line: { color: '#9b59b6', width: 2 } }
    ], {
        margin: { l: 40, r: 20, t: 10, b: 30 },
        xaxis: { title: 'Sample Index' },
        yaxis: { title: 'Acceleration (m/s²)' },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: 'white',
        legend: { x: 0.01, y: 0.99 }
    }, { responsive: true });
}

// 자이로 차트
function createGyroChart(data) {
    if (!data || data.length === 0) {
        document.getElementById('gyroChart').innerHTML = '<div style="text-align:center;padding:50px;color:#6c757d;">데이터 없음</div>';
        return;
    }
    
    const times = data.map((_, i) => i);
    // 라디안을 도(degree)로 변환
    const radToDeg = (rad) => rad * (180 / Math.PI);
    const x = data.map(d => radToDeg(parseFloat(d.x || 0)));
    const y = data.map(d => radToDeg(parseFloat(d.y || 0)));
    const z = data.map(d => radToDeg(parseFloat(d.z || 0)));
    const mag = data.map(d => {
        const xRad = parseFloat(d.x || 0);
        const yRad = parseFloat(d.y || 0);
        const zRad = parseFloat(d.z || 0);
        return radToDeg(Math.sqrt(xRad ** 2 + yRad ** 2 + zRad ** 2));
    });
    
    Plotly.newPlot('gyroChart', [
        { x: times, y: x, name: 'X', type: 'scatter', mode: 'lines', line: { color: '#e74c3c', width: 1 } },
        { x: times, y: y, name: 'Y', type: 'scatter', mode: 'lines', line: { color: '#3498db', width: 1 } },
        { x: times, y: z, name: 'Z', type: 'scatter', mode: 'lines', line: { color: '#2ecc71', width: 2 } },
        { x: times, y: mag, name: 'Magnitude', type: 'scatter', mode: 'lines', line: { color: '#9b59b6', width: 2 } }
    ], {
        margin: { l: 40, r: 20, t: 10, b: 30 },
        xaxis: { title: 'Sample Index' },
        yaxis: { title: 'Angular Velocity (°/s)' },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: 'white',
        legend: { x: 0.01, y: 0.99 }
    }, { responsive: true });
}

// Orientation 차트
function createOrientChart(data) {
    if (!data || data.length === 0) {
        document.getElementById('orientChart').innerHTML = '<div style="text-align:center;padding:50px;color:#6c757d;">Orientation 데이터 없음</div>';
        return;
    }
    
    const times = data.map((_, i) => i);
    const azimuth = data.map(d => parseFloat(d.azimuth || d.yaw || 0));
    const pitch = data.map(d => parseFloat(d.pitch || 0));
    const roll = data.map(d => parseFloat(d.roll || 0));
    const qx = data.map(d => parseFloat(d.qx || 0));
    const qy = data.map(d => parseFloat(d.qy || 0));
    const qz = data.map(d => parseFloat(d.qz || 0));
    const qw = data.map(d => parseFloat(d.qw || 0));
    
    Plotly.newPlot('orientChart', [
        { x: times, y: azimuth, name: 'Azimuth/Yaw', type: 'scatter', mode: 'lines', line: { color: '#e67e22', width: 2 } },
        { x: times, y: pitch, name: 'Pitch', type: 'scatter', mode: 'lines', line: { color: '#16a085', width: 1 } },
        { x: times, y: roll, name: 'Roll', type: 'scatter', mode: 'lines', line: { color: '#c0392b', width: 2 } },
        { x: times, y: qy, name: 'Quaternion Y', type: 'scatter', mode: 'lines', line: { color: '#9b59b6', width: 1 }, visible: 'legendonly' },
        { x: times, y: qz, name: 'Quaternion Z', type: 'scatter', mode: 'lines', line: { color: '#3498db', width: 1 }, visible: 'legendonly' }
    ], {
        margin: { l: 40, r: 20, t: 10, b: 30 },
        xaxis: { title: 'Sample Index' },
        yaxis: { title: 'Angle (degrees) / Quaternion' },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: 'white',
        legend: { x: 0.01, y: 0.99 }
    }, { responsive: true });
}

// 턴 검출
function initTurnDetection() {
    document.getElementById('detectTurnsBtn').onclick = detectTurns;
}

function detectTurns() {
    const algorithm = document.getElementById('detectionAlgorithm').value;
    const peakThreshold = parseFloat(document.getElementById('peakThreshold').value);
    const minDistance = parseInt(document.getElementById('minPeakDistance').value);
    
    const data = currentSection !== null ? savedSections[currentSection] : {
        locationData, accelData, gyroData, orientData
    };
    
    detectedTurns = [];
    
    if (!data.orientData || data.orientData.length === 0) {
        alert('Orientation 데이터가 없습니다');
        updateTurnList();
        return;
    }
    
    switch(algorithm) {
        case 'quaternion_magnitude':
            detectTurnsQuaternionMagnitude(data.orientData, peakThreshold, minDistance);
            break;
        case 'quaternion_angle':
            detectTurnsQuaternionAngle(data.orientData, peakThreshold, minDistance);
            break;
        case 'qy_peak':
            detectTurnsQuaternionComponent(data.orientData, 'qy', peakThreshold, minDistance);
            break;
        case 'qz_peak':
            detectTurnsQuaternionComponent(data.orientData, 'qz', peakThreshold, minDistance);
            break;
        case 'roll_pitch':
            detectTurnsRollPitch(data.orientData, peakThreshold, minDistance);
            break;
        case 'orientation':
        default:
            detectTurnsOrientation(data.orientData, 5, 15);
            break;
    }
    
    // 그래프에 턴 시점 표시
    highlightTurnsOnChart();
    updateTurnList();
    updateMotionStats(data);
}

// 피크 검출 헬퍼 함수
function findPeaks(data, threshold, minDistance) {
    const peaks = [];
    
    for (let i = 1; i < data.length - 1; i++) {
        const current = data[i];
        const prev = data[i - 1];
        const next = data[i + 1];
        
        // 로컬 최대값 검출
        if (current > prev && current > next && Math.abs(current) > threshold) {
            // 최소 거리 체크
            if (peaks.length === 0 || i - peaks[peaks.length - 1].index >= minDistance) {
                peaks.push({ index: i, value: current });
            }
        }
    }
    
    return peaks;
}

// 1. Quaternion 변화율 기반 검출
function detectTurnsQuaternionMagnitude(data, threshold, minDistance) {
    const changes = [];
    
    for (let i = 1; i < data.length; i++) {
        const qx1 = parseFloat(data[i - 1].qx || 0);
        const qy1 = parseFloat(data[i - 1].qy || 0);
        const qz1 = parseFloat(data[i - 1].qz || 0);
        const qw1 = parseFloat(data[i - 1].qw || 0);
        
        const qx2 = parseFloat(data[i].qx || 0);
        const qy2 = parseFloat(data[i].qy || 0);
        const qz2 = parseFloat(data[i].qz || 0);
        const qw2 = parseFloat(data[i].qw || 0);
        
        // Quaternion 차이의 크기 계산
        const diff = Math.sqrt(
            Math.pow(qx2 - qx1, 2) +
            Math.pow(qy2 - qy1, 2) +
            Math.pow(qz2 - qz1, 2) +
            Math.pow(qw2 - qw1, 2)
        );
        
        changes.push(diff);
    }
    
    const peaks = findPeaks(changes, threshold, minDistance);
    
    peaks.forEach(peak => {
        const idx = peak.index + 1;
        const roll = parseFloat(data[idx].roll || 0);
        const direction = roll > 0 ? 'Right' : 'Left';
        
        detectedTurns.push({
            index: idx,
            time: data[idx].time,
            type: 'quaternion_magnitude',
            direction,
            magnitude: peak.value,
            roll: roll,
            speed: peak.value * 100
        });
    });
}

// 2. Quaternion 각도 변화 기반 검출
function detectTurnsQuaternionAngle(data, threshold, minDistance) {
    const angles = [];
    
    for (let i = 1; i < data.length; i++) {
        const qx1 = parseFloat(data[i - 1].qx || 0);
        const qy1 = parseFloat(data[i - 1].qy || 0);
        const qz1 = parseFloat(data[i - 1].qz || 0);
        const qw1 = parseFloat(data[i - 1].qw || 0);
        
        const qx2 = parseFloat(data[i].qx || 0);
        const qy2 = parseFloat(data[i].qy || 0);
        const qz2 = parseFloat(data[i].qz || 0);
        const qw2 = parseFloat(data[i].qw || 0);
        
        // Quaternion 내적 계산
        const dot = qx1 * qx2 + qy1 * qy2 + qz1 * qz2 + qw1 * qw2;
        const angle = 2 * Math.acos(Math.min(1, Math.abs(dot))) * (180 / Math.PI);
        
        angles.push(angle);
    }
    
    const peaks = findPeaks(angles, threshold * 10, minDistance);
    
    peaks.forEach(peak => {
        const idx = peak.index + 1;
        const roll = parseFloat(data[idx].roll || 0);
        const direction = roll > 0 ? 'Right' : 'Left';
        
        detectedTurns.push({
            index: idx,
            time: data[idx].time,
            type: 'quaternion_angle',
            direction,
            angle: peak.value,
            roll: roll,
            speed: peak.value
        });
    });
}

// 3. Quaternion 특정 컴포넌트 피크 검출
function detectTurnsQuaternionComponent(data, component, threshold, minDistance) {
    const values = data.map(d => parseFloat(d[component] || 0));
    
    // 절댓값 피크 검출
    const absValues = values.map(v => Math.abs(v));
    const peaks = findPeaks(absValues, threshold, minDistance);
    
    peaks.forEach(peak => {
        const idx = peak.index;
        const roll = parseFloat(data[idx].roll || 0);
        const direction = values[idx] > 0 ? 'Right' : 'Left';
        
        detectedTurns.push({
            index: idx,
            time: data[idx].time,
            type: `${component}_peak`,
            direction,
            componentValue: values[idx],
            roll: roll,
            speed: Math.abs(values[idx]) * 100
        });
    });
}

// 4. Roll + Pitch 조합 피크 검출
function detectTurnsRollPitch(data, threshold, minDistance) {
    const combined = data.map(d => {
        const roll = parseFloat(d.roll || 0);
        const pitch = parseFloat(d.pitch || 0);
        return Math.sqrt(roll * roll + pitch * pitch);
    });
    
    const peaks = findPeaks(combined, threshold * 20, minDistance);
    
    peaks.forEach(peak => {
        const idx = peak.index;
        const roll = parseFloat(data[idx].roll || 0);
        const pitch = parseFloat(data[idx].pitch || 0);
        const direction = roll > 0 ? 'Right' : 'Left';
        
        detectedTurns.push({
            index: idx,
            time: data[idx].time,
            type: 'roll_pitch',
            direction,
            magnitude: peak.value,
            roll: roll,
            pitch: pitch,
            speed: peak.value
        });
    });
}

// 그래프에 턴 시점 표시
function highlightTurnsOnChart() {
    if (detectedTurns.length === 0) return;
    
    const shapes = detectedTurns.map(turn => ({
        type: 'line',
        x0: turn.index,
        x1: turn.index,
        y0: 0,
        y1: 1,
        yref: 'paper',
        line: {
            color: turn.direction === 'Right' ? '#e74c3c' : '#3498db',
            width: 2,
            dash: 'dash'
        }
    }));
    
    const annotations = detectedTurns.map(turn => ({
        x: turn.index,
        y: 1,
        yref: 'paper',
        text: turn.direction === 'Right' ? 'R' : 'L',
        showarrow: false,
        font: {
            color: turn.direction === 'Right' ? '#e74c3c' : '#3498db',
            size: 10,
            family: 'Arial, sans-serif'
        },
        bgcolor: 'rgba(255, 255, 255, 0.8)',
        borderpad: 2
    }));
    
    Plotly.relayout('orientChart', { shapes, annotations });
}

function detectTurnsOrientation(data, azimuthThresh, rollThresh) {
    if (!data || data.length === 0) return;
    
    for (let i = 1; i < data.length; i++) {
        const prevAzimuth = parseFloat(data[i - 1].azimuth || 0);
        const currAzimuth = parseFloat(data[i].azimuth || 0);
        const roll = Math.abs(parseFloat(data[i].roll || 0));
        
        let azimuthChange = Math.abs(currAzimuth - prevAzimuth);
        if (azimuthChange > 180) azimuthChange = 360 - azimuthChange;
        
        if (azimuthChange > azimuthThresh && roll > rollThresh) {
            const direction = parseFloat(data[i].roll || 0) > 0 ? 'Right' : 'Left';
            detectedTurns.push({
                index: i,
                time: data[i].time,
                type: 'orientation',
                direction,
                azimuthChange,
                roll: parseFloat(data[i].roll || 0),
                speed: azimuthChange / ((parseInt(data[i].time) - parseInt(data[i - 1].time)) / 1e9)
            });
        }
    }
}

function detectTurnsGyroscope(data) {
    if (!data || data.length === 0) return;
    
    for (let i = 0; i < data.length; i++) {
        const gyroZ = Math.abs(parseFloat(data[i].z || 0));
        if (gyroZ > 0.3) {
            const direction = parseFloat(data[i].z || 0) > 0 ? 'Right' : 'Left';
            detectedTurns.push({
                index: i,
                time: data[i].time,
                type: 'gyroscope',
                direction,
                gyroZ: parseFloat(data[i].z || 0),
                speed: gyroZ
            });
        }
    }
}

function updateTurnList() {
    const list = document.getElementById('turnList');
    
    if (detectedTurns.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 40px; font-size: 13px;">검출된 턴이 없습니다</div>';
        return;
    }
    
    list.innerHTML = '';
    detectedTurns.forEach((turn, idx) => {
        const div = document.createElement('div');
        div.className = `turn-item ${turn.direction.toLowerCase()}`;
        
        let detailsHTML = `
            <div>Type: ${turn.type}</div>
            <div>Speed: ${turn.speed.toFixed(2)} °/s</div>
        `;
        
        if (turn.magnitude !== undefined) {
            detailsHTML += `<div>Magnitude: ${turn.magnitude.toFixed(4)}</div>`;
        }
        if (turn.angle !== undefined) {
            detailsHTML += `<div>Angle: ${turn.angle.toFixed(2)}°</div>`;
        }
        if (turn.componentValue !== undefined) {
            detailsHTML += `<div>Value: ${turn.componentValue.toFixed(4)}</div>`;
        }
        if (turn.roll !== undefined) {
            detailsHTML += `<div>Roll: ${turn.roll.toFixed(1)}°</div>`;
        }
        if (turn.pitch !== undefined) {
            detailsHTML += `<div>Pitch: ${turn.pitch.toFixed(1)}°</div>`;
        }
        if (turn.azimuthChange !== undefined) {
            detailsHTML += `<div>Azimuth Δ: ${turn.azimuthChange.toFixed(1)}°</div>`;
        }
        if (turn.gyroZ !== undefined) {
            detailsHTML += `<div>Gyro Z: ${turn.gyroZ.toFixed(3)} rad/s</div>`;
        }
        
        div.innerHTML = `
            <div class="turn-header">🎯 Turn ${idx + 1} - ${turn.direction}</div>
            <div class="turn-details">${detailsHTML}</div>
        `;
        
        div.onclick = () => {
            currentIndex2 = turn.index;
            updateMotionMarkerPosition(turn.index);
            document.querySelectorAll('.turn-item').forEach(t => t.classList.remove('selected'));
            div.classList.add('selected');
        };
        list.appendChild(div);
    });
}

function updateMotionStats(data) {
    document.getElementById('totalTurns').textContent = detectedTurns.length;
    
    if (detectedTurns.length > 0) {
        const avgSpeed = detectedTurns.reduce((s, t) => s + t.speed, 0) / detectedTurns.length;
        document.getElementById('avgTurnSpeed').textContent = avgSpeed.toFixed(2);
    } else {
        document.getElementById('avgTurnSpeed').textContent = '-';
    }
    
    if (data.accelData.length > 0) {
        const maxAccel = Math.max(...data.accelData.map(d => 
            Math.sqrt(parseFloat(d.x || 0) ** 2 + parseFloat(d.y || 0) ** 2 + parseFloat(d.z || 0) ** 2)
        ));
        document.getElementById('maxAccel').textContent = maxAccel.toFixed(2);
        document.getElementById('avgGForce').textContent = (maxAccel / 9.81).toFixed(2);
    } else {
        document.getElementById('maxAccel').textContent = '-';
        document.getElementById('avgGForce').textContent = '-';
    }
}
