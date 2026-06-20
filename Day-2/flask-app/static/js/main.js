// Global state
let allUpdates = [];
let filteredUpdates = [];
let currentCategory = 'all';
let searchQuery = '';
let selectedUpdateForTweet = null;

// DOM Elements
const btnRefresh = document.getElementById('btn-refresh');
const refreshIcon = document.getElementById('refresh-icon');
const filterCategories = document.getElementById('filter-categories');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const statsTotal = document.getElementById('stats-total');
const statsTotalSidebar = document.getElementById('count-all');
const feedContainer = document.getElementById('feed-container');

const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');
const btnRetry = document.getElementById('btn-retry');
const emptyState = document.getElementById('empty-state');

// Modal Elements
const tweetModal = document.getElementById('tweet-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelTweet = document.getElementById('btn-cancel-tweet');
const btnSendTweet = document.getElementById('btn-send-tweet');
const tweetTextarea = document.getElementById('tweet-textarea');
const charCount = document.getElementById('char-count');
const previewBadge = document.getElementById('preview-badge');
const previewDate = document.getElementById('preview-date');
const previewText = document.getElementById('preview-text');
const chipGA = document.getElementById('chip-ga');

// Progress ring variables
const circle = document.querySelector('.progress-ring__circle');
const radius = circle ? circle.r.baseVal.value : 10;
const circumference = radius * 2 * Math.PI;

if (circle) {
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference;
}

// ----------------------------------------------------
// INITIALIZATION & EVENT LISTENERS
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    fetchReleaseNotes();

    btnRefresh.addEventListener('click', fetchReleaseNotes);
    btnRetry.addEventListener('click', fetchReleaseNotes);

    // Search logic
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        if (searchQuery.length > 0) {
            searchClearBtn.style.display = 'block';
        } else {
            searchClearBtn.style.display = 'none';
        }
        applyFiltersAndSearch();
    });

    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        searchClearBtn.style.display = 'none';
        applyFiltersAndSearch();
        searchInput.focus();
    });

    // Modal Events
    btnCloseModal.addEventListener('click', closeComposer);
    btnCancelTweet.addEventListener('click', closeComposer);
    btnSendTweet.addEventListener('click', postTweet);
    tweetTextarea.addEventListener('input', updateCharCounter);

    // Close modal on background click
    tweetModal.addEventListener('click', (e) => {
        if (e.target === tweetModal) {
            closeComposer();
        }
    });

    // Template Chip events
    document.querySelectorAll('.template-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            document.querySelectorAll('.template-chip').forEach(c => c.classList.remove('active'));
            e.currentTarget.classList.add('active');
            applyTemplate(e.currentTarget.dataset.templateId);
        });
    });
});

// ----------------------------------------------------
// FETCH DATA
// ----------------------------------------------------
async function fetchReleaseNotes() {
    setLoading(true);
    try {
        const response = await fetch('/api/notes');
        const data = await response.json();
        
        if (data.error) {
            showError(data.error);
            return;
        }

        allUpdates = data.updates || [];
        updateSidebarCategoryCounts();
        applyFiltersAndSearch();
        setLoading(false);
    } catch (err) {
        showError('Network request failed. Please check if your backend flask server is running.');
    }
}

// UI State Management
function setLoading(isLoading) {
    if (isLoading) {
        loadingState.classList.remove('hidden');
        feedContainer.classList.add('hidden');
        errorState.classList.add('hidden');
        emptyState.classList.add('hidden');
        refreshIcon.classList.add('spin');
        btnRefresh.disabled = true;
    } else {
        loadingState.classList.add('hidden');
        refreshIcon.classList.remove('spin');
        btnRefresh.disabled = false;
    }
}

function showError(msg) {
    setLoading(false);
    errorMessage.textContent = msg;
    errorState.classList.remove('hidden');
    feedContainer.classList.add('hidden');
}

// ----------------------------------------------------
// FILTER & SEARCH LOGIC
// ----------------------------------------------------
function updateSidebarCategoryCounts() {
    // Count occurrences
    const counts = { all: allUpdates.length };
    
    allUpdates.forEach(update => {
        const type = update.type ? update.type.toLowerCase() : 'general';
        counts[type] = (counts[type] || 0) + 1;
    });

    // Reset list
    const activeClass = currentCategory === 'all' ? 'active' : '';
    let html = `
        <button class="filter-btn ${activeClass}" data-type="all">
            <span class="dot dot-all"></span>
            <span class="filter-label">All Updates</span>
            <span class="count-badge">${counts.all}</span>
        </button>
    `;

    // Categorized lists
    const sortedTypes = Object.keys(counts).filter(k => k !== 'all').sort();
    sortedTypes.forEach(type => {
        const activeClass = currentCategory === type ? 'active' : '';
        const displayName = type.charAt(0).toUpperCase() + type.slice(1);
        const dotClass = `dot-${type}`;
        
        html += `
            <button class="filter-btn ${activeClass}" data-type="${type}">
                <span class="dot ${dotClass}"></span>
                <span class="filter-label">${displayName}</span>
                <span class="count-badge">${counts[type]}</span>
            </button>
        `;
    });

    filterCategories.innerHTML = html;

    // Attach click listeners to new buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            const type = e.currentTarget.dataset.type;
            e.currentTarget.classList.add('active');
            currentCategory = type;
            applyFiltersAndSearch();
        });
    });
}

function applyFiltersAndSearch() {
    // Apply Category Filter
    if (currentCategory === 'all') {
        filteredUpdates = [...allUpdates];
    } else {
        filteredUpdates = allUpdates.filter(u => u.type.toLowerCase() === currentCategory);
    }

    // Apply Search Filter
    if (searchQuery) {
        filteredUpdates = filteredUpdates.filter(u => {
            const matchesTitle = u.date.toLowerCase().includes(searchQuery);
            const matchesContent = u.text_content.toLowerCase().includes(searchQuery);
            const matchesType = u.type.toLowerCase().includes(searchQuery);
            return matchesTitle || matchesContent || matchesType;
        });
    }

    // Update Stats
    statsTotal.textContent = filteredUpdates.length;

    // Render Cards
    renderFeed();
}

// ----------------------------------------------------
// RENDERING FEED CARDS
// ----------------------------------------------------
function renderFeed() {
    if (filteredUpdates.length === 0) {
        feedContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    feedContainer.classList.remove('hidden');

    const html = filteredUpdates.map(update => {
        let displayContent = update.content;
        let displayDate = update.date;
        let displayType = update.type;

        // Highlight matching search words
        if (searchQuery) {
            displayContent = highlightMatch(displayContent, searchQuery);
            displayDate = highlightMatch(displayDate, searchQuery);
            displayType = highlightMatch(displayType, searchQuery);
        }

        const badgeClass = `badge-${update.type.toLowerCase()}`;

        return `
            <article class="note-card" id="card-${update.id}">
                <div class="note-header">
                    <div class="note-meta">
                        <span class="badge ${badgeClass}">${displayType}</span>
                        <span class="note-date">${displayDate}</span>
                    </div>
                    <div class="note-actions">
                        <button class="card-action-btn tweet-btn" onclick="openComposer('${update.id}')">
                            <i class="fa-brands fa-twitter"></i> Tweet
                        </button>
                        <a href="${update.link}" target="_blank" class="card-action-btn">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i> Docs
                        </a>
                    </div>
                </div>
                <div class="note-content">
                    ${displayContent}
                </div>
            </article>
        `;
    }).join('');

    feedContainer.innerHTML = html;
}

function highlightMatch(text, query) {
    if (!text || !query) return text;
    // Simple regex highlight, avoid replacing tags
    // Let's create an safe regex matching
    try {
        const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
        // Only match outside HTML tags to avoid breaking markup
        return text.replace(/(<[^>]+>)|([^<]+)/g, (match, tag, textContent) => {
            if (tag) return tag; // Return tag as is
            return textContent.replace(regex, '<span class="match-highlight">$1</span>');
        });
    } catch (e) {
        return text;
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ----------------------------------------------------
// TWEET COMPOSER MODAL LOGIC
// ----------------------------------------------------
function openComposer(updateId) {
    const update = allUpdates.find(u => u.id === updateId);
    if (!update) return;

    selectedUpdateForTweet = update;

    // Load preview content into modal
    previewBadge.className = `badge badge-${update.type.toLowerCase()}`;
    previewBadge.textContent = update.type;
    previewDate.textContent = update.date;
    previewText.textContent = update.text_content;

    // Check if GA launch template is applicable (e.g. contains generally available, ga)
    const isGA = update.text_content.toLowerCase().includes('generally available') || 
                 update.text_content.toLowerCase().includes('(ga)');
    if (isGA) {
        chipGA.style.display = 'inline-block';
    } else {
        chipGA.style.display = 'none';
    }

    // Default template active: Brief
    document.querySelectorAll('.template-chip').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-template-id="brief"]').classList.add('active');
    
    applyTemplate('brief');
    
    // Show Modal
    tweetModal.classList.remove('hidden');
    tweetTextarea.focus();
}

function closeComposer() {
    tweetModal.classList.add('hidden');
    selectedUpdateForTweet = null;
}

function applyTemplate(templateId) {
    if (!selectedUpdateForTweet) return;

    const u = selectedUpdateForTweet;
    const url = u.link || 'https://cloud.google.com/bigquery';
    
    // Max description length to avoid going way over character limit
    let desc = u.text_content;
    
    let draft = "";
    switch (templateId) {
        case 'brief':
            // Cut text content if needed
            let truncatedBrief = desc.length > 150 ? desc.substring(0, 147) + "..." : desc;
            draft = `💡 BQ ${u.type} (${u.date}):\n"${truncatedBrief}"\n\nDetails: ${url} #BigQuery #GCP`;
            break;
            
        case 'detailed':
            let truncatedDetailed = desc.length > 180 ? desc.substring(0, 177) + "..." : desc;
            draft = `📝 New BigQuery Update\n📅 ${u.date}\n🏷️ Class: ${u.type}\n\n${truncatedDetailed}\n\nDocs: ${url} #GoogleCloud #DataEngineering`;
            break;
            
        case 'ga':
            let truncatedGA = desc.length > 160 ? desc.substring(0, 157) + "..." : desc;
            draft = `🚀 BigQuery GA Launch!\n\n${truncatedGA}\n\nRead more here: ${url} #BigQuery #CloudComputing`;
            break;
    }

    tweetTextarea.value = draft;
    updateCharCounter();
}

function updateCharCounter() {
    const textLength = tweetTextarea.value.length;
    charCount.textContent = textLength;

    // Handle warning states
    if (textLength >= 280) {
        charCount.className = 'character-counter danger';
        btnSendTweet.disabled = true;
    } else if (textLength >= 250) {
        charCount.className = 'character-counter warning';
        btnSendTweet.disabled = false;
    } else {
        charCount.className = 'character-counter';
        btnSendTweet.disabled = false;
    }

    // Progress Ring offset animation
    if (circle) {
        const offset = circumference - (Math.min(textLength, 280) / 280) * circumference;
        circle.style.strokeDashoffset = offset;
        
        // Color changes for progress ring
        if (textLength >= 280) {
            circle.style.stroke = '#f43f5e'; // Red
        } else if (textLength >= 250) {
            circle.style.stroke = '#f59e0b'; // Amber
        } else {
            circle.style.stroke = '#1d9bf0'; // Twitter Blue
        }
    }
}

function postTweet() {
    const tweetText = tweetTextarea.value;
    if (tweetText.length > 280) {
        alert('Tweet exceeds the 280 character limit.');
        return;
    }

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
    window.open(twitterUrl, '_blank');
    closeComposer();
}
