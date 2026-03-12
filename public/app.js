const columns = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'inProgress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'complete', label: 'Complete' }
];

const defaultBoard = {
  columns: {
    backlog: [],
    inProgress: [],
    blocked: [],
    complete: []
  }
};

let boardState = null;
let draggedTaskId = null;
let refreshTimer = null;

const $ = selector => document.querySelector(selector);

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function scoreLabel(score) {
  if (score >= 90) return 'Strong posture';
  if (score >= 75) return 'Good, but tighten a few things';
  if (score >= 60) return 'Moderate risk';
  return 'Needs attention';
}

function riskPillText(score) {
  if (score >= 90) return 'Low risk posture';
  if (score >= 75) return 'Controlled risk posture';
  if (score >= 60) return 'Moderate risk posture';
  return 'Attention needed';
}

function persistBoard() {
  localStorage.setItem('mission-control-kanban', JSON.stringify(boardState));
}

function loadStoredBoard() {
  const raw = localStorage.getItem('mission-control-kanban');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function renderStatus(status) {
  $('#lastUpdated').textContent = `Updated ${new Date(status.generatedAt).toLocaleString()}`;
  $('#scoreValue').textContent = status.securityScore;
  $('#scoreLabel').textContent = scoreLabel(status.securityScore);
  $('#heroRiskPill').textContent = `${riskPillText(status.securityScore)} · ${status.mode || 'live'}`;
  $('#scoreBreakdown').innerHTML = `
    <li>${status.securitySummary.critical} critical</li>
    <li>${status.securitySummary.warn} warnings</li>
    <li>${status.securitySummary.info} info</li>
  `;

  const cards = [
    { label: 'Agents', value: status.agentCount, detail: 'Active OpenClaw agents' },
    { label: 'Sessions', value: status.sessions, detail: 'Current live sessions' },
    { label: 'Heartbeat', value: status.heartbeatSeconds ? `${Math.round(status.heartbeatSeconds / 60)}m` : 'Off', detail: 'Main session heartbeat' },
    { label: 'Channels', value: status.channels.length, detail: 'Configured channel surfaces' }
  ];
  $('#statusCards').innerHTML = cards.map(card => `
    <div class="stat-card">
      <span>${card.label}</span>
      <strong>${card.value}</strong>
      <small>${card.detail}</small>
    </div>
  `).join('');

  const issues = status.findings.filter(f => f.severity !== 'info');
  $('#issueCount').textContent = `${issues.length} issue${issues.length === 1 ? '' : 's'}`;
  const issueTemplate = $('#issueTemplate');
  $('#issuesList').innerHTML = '';
  if (!issues.length) $('#issuesList').innerHTML = '<p>No active security issues.</p>';

  for (const issue of issues) {
    const node = issueTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.issue-severity').textContent = issue.severity;
    node.querySelector('.issue-severity').classList.add(issue.severity);
    node.querySelector('.issue-id').textContent = issue.checkId;
    node.querySelector('.issue-title').textContent = issue.title;
    node.querySelector('.issue-detail').textContent = issue.detail;
    node.querySelector('.issue-remediation').textContent = issue.remediation || 'No remediation text provided.';
    $('#issuesList').appendChild(node);
  }

  $('#channelSignals').innerHTML = status.channels.length
    ? status.channels.map(channel => `
        <div class="channel-card">
          <strong>${channel.id}</strong>
          <p>Configured: ${channel.configured ? 'yes' : 'no'} · Linked: ${channel.linked ? 'yes' : 'no'} · Running: ${channel.running ? 'yes' : 'no'} · Connected: ${channel.connected ? 'yes' : 'no'}</p>
          ${channel.lastError ? `<p>Last error: ${channel.lastError}</p>` : ''}
        </div>
      `).join('')
    : '<p>No channel telemetry available.</p>';

  $('#updateText').textContent = status.updateText;
}

function moveTask(taskId, targetColumn) {
  let task = null;
  for (const column of columns) {
    const tasks = boardState.columns[column.key];
    const index = tasks.findIndex(item => item.id === taskId);
    if (index >= 0) {
      task = tasks.splice(index, 1)[0];
      break;
    }
  }
  if (!task) return;
  boardState.columns[targetColumn].unshift(task);
  persistBoard();
}

function attachColumnDrop(wrapper, columnKey) {
  wrapper.addEventListener('dragover', event => {
    event.preventDefault();
    wrapper.classList.add('drag-over');
  });
  wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
  wrapper.addEventListener('drop', event => {
    event.preventDefault();
    wrapper.classList.remove('drag-over');
    if (!draggedTaskId) return;
    moveTask(draggedTaskId, columnKey);
    draggedTaskId = null;
    renderBoard();
  });
}

function renderBoard() {
  const board = $('#kanbanBoard');
  board.innerHTML = '';
  const taskTemplate = $('#taskTemplate');

  for (const column of columns) {
    const wrapper = document.createElement('section');
    wrapper.className = 'kanban-column';
    wrapper.dataset.column = column.key;
    wrapper.innerHTML = `
      <header>
        <h3>${column.label}</h3>
        <span class="pill">${boardState.columns[column.key].length}</span>
      </header>
      <div class="kanban-stack"></div>
    `;

    attachColumnDrop(wrapper, column.key);
    const stack = wrapper.querySelector('.kanban-stack');

    for (const task of boardState.columns[column.key]) {
      const card = taskTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.taskId = task.id;
      card.querySelector('.task-title').textContent = task.title;
      card.querySelector('.task-description').textContent = task.description || 'No extra detail.';
      card.addEventListener('dragstart', () => {
        draggedTaskId = task.id;
      });

      const actions = card.querySelector('.task-actions');
      for (const destination of columns.filter(item => item.key !== column.key)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = destination.label;
        button.addEventListener('click', () => {
          moveTask(task.id, destination.key);
          renderBoard();
        });
        actions.appendChild(button);
      }
      stack.appendChild(card);
    }

    board.appendChild(wrapper);
  }
}

async function loadBoard() {
  const stored = loadStoredBoard();
  if (stored?.columns) {
    boardState = stored;
    renderBoard();
    return;
  }
  boardState = await fetchJson('/data/kanban.json');
  persistBoard();
  renderBoard();
}

async function loadStatus() {
  try {
    const status = await fetchJson('/data/status.json');
    renderStatus(status);
  } catch (error) {
    $('#lastUpdated').textContent = `Status unavailable: ${error.message}`;
  }
}

function configureAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if ($('#autoRefreshToggle').checked) refreshTimer = setInterval(loadStatus, 30000);
}

$('#refreshStatus').addEventListener('click', loadStatus);
$('#autoRefreshToggle').addEventListener('change', configureAutoRefresh);
$('#newTaskForm').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#taskTitle').value.trim();
  const description = $('#taskDescription').value.trim();
  if (!title) return;
  boardState.columns.backlog.unshift({
    id: `task-${crypto.randomUUID()}`,
    title,
    description,
    createdAt: new Date().toISOString()
  });
  $('#taskTitle').value = '';
  $('#taskDescription').value = '';
  persistBoard();
  renderBoard();
});

await Promise.all([loadStatus(), loadBoard()]);
configureAutoRefresh();
