const API_BASE = "https://fullord-spatial-search.hf.space";
let catalogData = [];
let isLive = true;
let activeItemName = null;
let showLiveBoxes = false;

const searchInput = document.getElementById('searchInput');
const dateFilter = document.getElementById('dateFilter');
const timeFilter = document.getElementById('timeFilter');
const catalogList = document.getElementById('catalogList');
const detectionCounter = document.getElementById('detectionCounter');
const scanTimerDisplay = document.getElementById('scanTimer');
const videoTimerDisplay = document.getElementById('videoTimer');

const resetBtn = document.getElementById('resetBtn');
const topRightLiveBtn = document.getElementById('topRightLiveBtn');
const toggleBoxesBtn = document.getElementById('toggleBoxesBtn');

const naDisplay = document.getElementById('naDisplay');
const workspaceContainer = document.getElementById('workspaceContainer');
const workspaceImage = document.getElementById('workspaceImage');
const boundingBox = document.getElementById('boundingBox');
const boxLabel = document.getElementById('boxLabel');

const timelineContainer = document.getElementById('timelineContainer');
const timeScrubber = document.getElementById('timeScrubber');
const scrubberLabel = document.getElementById('scrubberLabel');

let targetScanTime = Date.now() + 10000;
let videoRemainingSec = 0;

setInterval(async () => {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
            const data = await res.json();
            targetScanTime = Date.now() + data.scan_remaining_ms;
            videoRemainingSec = data.video_remaining_sec;
        }
    } catch {}
}, 1000);

setInterval(() => {
    let msLeft = targetScanTime - Date.now();
    if (msLeft < 0) msLeft = 0;
    scanTimerDisplay.textContent = msLeft;

    const m = Math.floor(videoRemainingSec / 60).toString().padStart(2, '0');
    const s = (videoRemainingSec % 60).toString().padStart(2, '0');
    videoTimerDisplay.textContent = `${m}:${s}`;
}, 40);

async function fetchCatalogData() {
    try {
        const res = await fetch(`${API_BASE}/api/data`);
        if (!res.ok) return;
        const rawData = await res.json();

        let totalDetections = 0;

        catalogData = rawData.map(group => {
            const sortedHistory = group.history.sort((a, b) =>
                new Date(`${a.date} ${a.time}`) - new Date(`${b.date} ${b.time}`)
            );
            totalDetections += sortedHistory.length;

            return {
                name: group.name,
                history: sortedHistory,
                latest: sortedHistory[sortedHistory.length - 1]
            };
        });

        catalogData.sort((a, b) =>
            new Date(`${b.latest.date} ${b.latest.time}`) -
            new Date(`${a.latest.date} ${a.latest.time}`)
        );

        detectionCounter.textContent = totalDetections;
        renderCatalog();

        if (activeItemName && !isLive) {
            const activeItem = catalogData.find(i => i.name === activeItemName);
            if (activeItem) {
                const wasAtLatest = parseInt(timeScrubber.value) === parseInt(timeScrubber.max);
                timeScrubber.max = activeItem.history.length - 1;

                if (wasAtLatest) {
                    timeScrubber.value = timeScrubber.max;
                    renderHistoryFrame(activeItemName, timeScrubber.value);
                }
            }
        }
    } catch {}
}

function renderCatalog() {
    const query = searchInput.value.toLowerCase().trim();
    const dateVal = dateFilter.value.trim();
    const timeVal = timeFilter.value.trim();

    catalogList.innerHTML = '';

    catalogData.forEach(item => {
        const matchName = query === "" || item.name.toLowerCase().includes(query);
        const matchDate = dateVal === "" || item.latest.date.includes(dateVal);
        const matchTime = timeVal === "" || item.latest.time.includes(timeVal);

        if (!(matchName && matchDate && matchTime)) return;

        const activeBg = (activeItemName === item.name && !isLive)
            ? 'bg-[#151515]'
            : 'bg-[#0a0a0a]';

        const li = document.createElement('li');
        li.className = `border-b border-[#1a1a1a] hover:bg-[#111111] cursor-pointer transition-all duration-300 group flex items-center justify-between px-5 py-4 ${activeBg}`;
        li.onclick = () => showItemPreview(item.name);

        li.innerHTML = `
            <div class="flex flex-col">
                <span class="text-[11px] font-bold tracking-wider text-white">
                    ${item.name}
                    <span class="text-[9px] font-normal text-blue-500 ml-1">(${item.history.length})</span>
                </span>
                <span class="text-[10px] text-[#555] mt-1">
                    Last seen: ${item.latest.date} | ${item.latest.time}
                </span>
            </div>
        `;
        catalogList.appendChild(li);
    });
}

function renderHistoryFrame(itemName, index) {
    if (isLive) return;

    const item = catalogData.find(i => i.name === itemName);
    if (!item) return;

    const frame = item.history[index];

    boundingBox.style.display = 'none';
    boundingBox.style.width = '0px';
    boundingBox.style.height = '0px';
    boxLabel.textContent = '';

    workspaceImage.src = frame.img;

    workspaceImage.onload = () => {
        if (isLive) return;

        if (frame.w && frame.h) {
            boundingBox.style.display = 'block';
            boundingBox.style.left = frame.x + '%';
            boundingBox.style.top = frame.y + '%';
            boundingBox.style.width = frame.w + '%';
            boundingBox.style.height = frame.h + '%';
            boxLabel.textContent = `${item.name} (${frame.conf.toFixed(2)})`;
        }
    };

    const isLatest = parseInt(index) === item.history.length - 1;
    scrubberLabel.textContent = isLatest ? 'LATEST' : `${frame.date} | ${frame.time}`;
}

function showItemPreview(itemName) {
    const item = catalogData.find(i => i.name === itemName);
    if (!item) return;

    isLive = false;
    activeItemName = item.name;

    naDisplay.classList.add('hidden');
    workspaceContainer.classList.remove('hidden');
    workspaceImage.classList.remove('hidden');
    timelineContainer.classList.remove('hidden');

    timeScrubber.max = item.history.length - 1;
    timeScrubber.value = item.history.length - 1;

    renderHistoryFrame(activeItemName, timeScrubber.value);
    renderCatalog();
}

timeScrubber.addEventListener('input', e => {
    if (activeItemName) renderHistoryFrame(activeItemName, e.target.value);
});

toggleBoxesBtn.addEventListener('click', () => {
    showLiveBoxes = !showLiveBoxes;
    toggleBoxesBtn.textContent = showLiveBoxes ? 'BOXES: ON' : 'BOXES: OFF';
    toggleBoxesBtn.classList.toggle('active', showLiveBoxes);

    if (isLive) {
        workspaceImage.src = `${API_BASE}/api/stream?annotated=${showLiveBoxes}`;
    }
});

function toggleLiveFeed() {
    isLive = true;
    activeItemName = null;

    naDisplay.classList.add('hidden');
    workspaceContainer.classList.remove('hidden');
    workspaceImage.classList.remove('hidden');
    timelineContainer.classList.add('hidden');

    boundingBox.style.display = 'none';
    boundingBox.style.width = '0px';
    boundingBox.style.height = '0px';
    boxLabel.textContent = '';

    workspaceImage.src = `${API_BASE}/api/stream?annotated=${showLiveBoxes}`;
    renderCatalog();
}

async function resetSystem() {
    const res = await fetch(`${API_BASE}/api/reset`, { method: 'POST' });
    if (!res.ok) return;

    catalogData = [];
    renderCatalog();
    detectionCounter.textContent = '0';
    workspaceContainer.classList.add('hidden');
    timelineContainer.classList.add('hidden');
    naDisplay.classList.remove('hidden');
    workspaceImage.src = '';
}

searchInput.addEventListener('input', renderCatalog);
dateFilter.addEventListener('input', renderCatalog);
timeFilter.addEventListener('input', renderCatalog);
resetBtn.addEventListener('click', resetSystem);
topRightLiveBtn.addEventListener('click', toggleLiveFeed);

fetchCatalogData();
toggleLiveFeed();
setInterval(fetchCatalogData, 5000);

