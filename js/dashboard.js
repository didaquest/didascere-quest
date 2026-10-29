import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, limit, orderBy, addDoc, setDoc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDjQbGWua0kdo2EWRrQKCCdbteKYG8C-MU",
    authDomain: "didascere-quest-c4f38.firebaseapp.com",
    projectId: "didascere-quest-c4f38",
    storageBucket: "didascere-quest-c4f38.firebasestorage.app",
    messagingSenderId: "179704025376",
    appId: "1:179704025376:web:4602eeb90c4e5b1ad04745",
    measurementId: "G-DK66LNFGTD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentUserRole = '';
let activeSessionId = null;
let unsubscribeLiveFeed = null;
let currentStudentsCache = [];
let assignedSections = [];
let auditLogsCache = [];
let livePresenceSnapshot = null;

document.addEventListener('DOMContentLoaded', () => {

    const teacherNameEl = document.getElementById('teacher-name');
    const teacherSectionEl = document.getElementById('teacher-section');
    const teacherAvatarImg = document.getElementById('teacher-avatar-img');
    const liveSectionSelect = document.getElementById('live-section-select');
    const rosterSectionSelect = document.getElementById('roster-section-select');
    const logoutBtn = document.getElementById('logout-btn');

    const navTabs = document.querySelectorAll('.nav-tab');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const mobileSidebarToggle = document.getElementById('mobileSidebarToggle');
    const dashboardSidebar = document.getElementById('dashboardSidebar');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');

    const closeMobileSidebar = () => {
        if (dashboardSidebar) dashboardSidebar.classList.remove('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');
    };

    if (mobileSidebarToggle) {
        mobileSidebarToggle.addEventListener('click', () => {
            dashboardSidebar.classList.toggle('open');
            sidebarBackdrop.classList.toggle('open');
        });
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    }

    let minigameTabLoaded = false;
    let auditLogsLoaded = false;
    navTabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            const targetId = tab.getAttribute('data-target');

            navTabs.forEach(t => t.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetPanel = document.getElementById(targetId);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }

            if (targetId === 'tab-minigames' && !minigameTabLoaded) {
                await loadMinigameSets();
                await loadMinigameResults();
                minigameTabLoaded = true;
            }
            if (targetId === 'tab-audit-logs' && !auditLogsLoaded) {
                auditLogsLoaded = await loadAuditLogs();
            }

            closeMobileSidebar();
        });
    });

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        try {
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (!userDoc.exists() || (userDoc.data().role !== 'teacher' && userDoc.data().role !== 'admin')) {
                await signOut(auth);
                window.location.href = 'login.html';
                return;
            }

            currentUser = user;
            const data = userDoc.data();
            currentUserRole = data.role;
            
            if (teacherNameEl) teacherNameEl.textContent = data.displayName || 'Unnamed Teacher';
            if (teacherSectionEl) teacherSectionEl.textContent = data.handledsection || 'No Section Assigned';
            if (teacherAvatarImg && data.avatar) teacherAvatarImg.src = `img/${data.avatar}`;

            const sectionsQuery = data.role === 'admin'
                ? collection(db, 'sections')
                : query(collection(db, 'sections'), where('teacherUid', '==', user.uid));
            const sectionsSnap = await getDocs(sectionsQuery);
            assignedSections = sectionsSnap.docs.map((sectionDoc) => ({
                id: sectionDoc.id,
                name: sectionDoc.data().name || sectionDoc.id
            }));
            
            let optionsHtml = '';
            if (sectionsSnap.empty) {
                optionsHtml = '<option value="" disabled selected>No sections assigned</option>';
            } else {
                optionsHtml = '<option value="" disabled selected>Select a section</option>';
                sectionsSnap.forEach(docSnap => {
                    optionsHtml += `<option value="${escapeHTML(docSnap.id)}">${escapeHTML(docSnap.data().name || docSnap.id)}</option>`;
                });
            }
            
            if (liveSectionSelect) liveSectionSelect.innerHTML = optionsHtml;
            if (rosterSectionSelect) rosterSectionSelect.innerHTML = optionsHtml;
            const minigameSectionSelect = document.getElementById('minigame-section-select');
            if (minigameSectionSelect) minigameSectionSelect.innerHTML = optionsHtml;
            if (liveSectionSelect) liveSectionSelect.addEventListener('change', () => loadSelectedLiveSection());
            if (sectionsSnap.size === 1 && liveSectionSelect) {
                liveSectionSelect.value = sectionsSnap.docs[0].id;
                await loadSelectedLiveSection();
            }
            if (sectionsSnap.size === 1 && minigameSectionSelect) minigameSectionSelect.value = sectionsSnap.docs[0].id;
            if (minigameSectionSelect) minigameSectionSelect.addEventListener('change', async () => {
                await loadMinigameSets();
                await loadMinigameResults();
            });
            document.querySelectorAll('.minigame-choice').forEach((button) => button.addEventListener('click', async () => {
                activeMinigameId = button.dataset.gameId;
                document.querySelectorAll('.minigame-choice').forEach((choice) => choice.classList.toggle('active', choice === button));
                await loadMinigameSets();
                await loadMinigameResults();
            }));
            document.getElementById('minigame-set-filter')?.addEventListener('change', loadMinigameResults);
            document.getElementById('refresh-minigame-results-btn')?.addEventListener('click', async () => {
                await Promise.all([loadMinigameSets(), loadMinigameResults()]);
                minigameTabLoaded = true;
            });
            document.getElementById('manage-minigame-btn')?.addEventListener('click', () => {
                document.getElementById('minigame-results-view').hidden = true;
                document.getElementById('manage-minigame-panel').hidden = false;
            });
            document.getElementById('close-manage-minigame-btn')?.addEventListener('click', () => {
                document.getElementById('manage-minigame-panel').hidden = true;
                document.getElementById('minigame-results-view').hidden = false;
            });
            document.getElementById('add-minigame-question-btn')?.addEventListener('click', () => addQuestionEditor());
            document.getElementById('minigame-set-form')?.addEventListener('submit', saveMinigameSet);
            addQuestionEditor();
        } catch (error) {
            console.error("Error verifying user data: ", error);
            await signOut(auth);
            window.location.href = 'login.html';
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut(auth).then(() => window.location.href = 'login.html');
        });
    }

    const generateRoomCodeBtn = document.getElementById('generateRoomCodeBtn');
    const copyRoomCodeBtn = document.getElementById('copyRoomCodeBtn');
    const endRoomSessionBtn = document.getElementById('endRoomSessionBtn');
    const activeSessionCodeEl = document.getElementById('active-session-code');
    const copyFeedbackEl = document.getElementById('copy-feedback');

    if (generateRoomCodeBtn) {
        generateRoomCodeBtn.addEventListener('click', async () => {
            const sectionId = liveSectionSelect.value;
            if (!sectionId) {
                alert('Please select a class section first.');
                return;
            }

            const code = createSecureCode('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
            
            try {
                const existingSessionsQuery = currentUserRole === 'admin'
                    ? query(collection(db, 'sessions'), where('sectionId', '==', sectionId))
                    : query(collection(db, 'sessions'), where('sectionId', '==', sectionId), where('teacherUid', '==', currentUser.uid));
                const existingSessions = await getDocs(existingSessionsQuery);
                for (const sessionDoc of existingSessions.docs) {
                    if (sessionDoc.data().status === 'active') {
                        await updateDoc(sessionDoc.ref, { status: 'ended', endedAt: serverTimestamp() });
                    }
                }
                const sessionRef = await addDoc(collection(db, 'sessions'), {
                    sectionId: sectionId,
                    teacherUid: currentUser.uid,
                    code: code,
                    createdAt: serverTimestamp(),
                    status: 'active'
                });

                activeSessionId = sessionRef.id;
                activeSessionCodeEl.textContent = code;
                
                generateRoomCodeBtn.style.display = 'none';
                copyRoomCodeBtn.style.display = 'inline-flex';
                endRoomSessionBtn.style.display = 'inline-flex';

                startLiveRoomListener(sectionId, activeSessionId);
            } catch (error) {
                console.error("Error creating session: ", error);
                activeSessionCodeEl.textContent = '------';
                endRoomSessionBtn.style.display = 'none';
                alert(getFirestoreErrorMessage(error, 'Could not start the class session.'));
            }
        });
    }

    if (copyRoomCodeBtn) {
        copyRoomCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(activeSessionCodeEl.textContent).then(() => {
                copyFeedbackEl.classList.add('show');
                setTimeout(() => copyFeedbackEl.classList.remove('show'), 2000);
        }).catch((error) => console.error('Could not copy room code:', error));
        });
    }

    if (endRoomSessionBtn) {
        endRoomSessionBtn.addEventListener('click', async () => {
            if (!activeSessionId) return;
            endRoomSessionBtn.disabled = true;
            try {
                await updateDoc(doc(db, 'sessions', activeSessionId), {
                    status: 'ended',
                    endedAt: serverTimestamp()
                });
                await loadSelectedLiveSection();
            } catch (error) {
                console.error('Could not end room session:', error);
                alert(getFirestoreErrorMessage(error, 'Could not end the class session.'));
            } finally {
                endRoomSessionBtn.disabled = false;
            }
        });
    }

    const generateLatePassBtn = document.getElementById('generateLatePassBtn');
    const latePassLrnInput = document.getElementById('late-pass-lrn-input');
    const latePassErrorEl = document.getElementById('late-pass-error');
    const generatedLatePassEl = document.getElementById('generated-late-pass');
    const latePassTargetLrnEl = document.getElementById('late-pass-target-lrn');

    if (generateLatePassBtn) {
        generateLatePassBtn.addEventListener('click', async () => {
            latePassErrorEl.textContent = '';
            const lrn = latePassLrnInput.value.trim();
            const sectionId = liveSectionSelect.value;

            if (!sectionId) {
                latePassErrorEl.textContent = 'Please select a class section first.';
                return;
            }
            if (lrn.length !== 12 || isNaN(lrn)) {
                latePassErrorEl.textContent = 'Please enter a valid 12-digit LRN.';
                return;
            }
            if (!activeSessionId) {
                latePassErrorEl.textContent = 'Start an active room session for this section first.';
                return;
            }

            try {
                generateLatePassBtn.disabled = true;
                const studentRef = doc(db, 'sections', sectionId, 'students', lrn);
                const studentSnap = await getDoc(studentRef);

                if (!studentSnap.exists()) {
                    latePassErrorEl.textContent = 'LRN not found in this section.';
                    generatedLatePassEl.textContent = '----';
                    latePassTargetLrnEl.textContent = 'None';
                    return;
                }

                const passCode = createSecureCode('0123456789', 4);
                const passRef = doc(db, 'session_codes', `${lrn}_${passCode}`);
                await setDoc(passRef, {
                    lrn: lrn,
                    code: passCode,
                    sectionId: sectionId,
                    sessionId: activeSessionId,
                    teacherUid: currentUser.uid,
                    createdAt: serverTimestamp(),
                    expiresAt: Timestamp.fromDate(new Date(Date.now() + 5 * 60 * 1000))
                });

                generatedLatePassEl.textContent = passCode;
                latePassTargetLrnEl.textContent = lrn;
                latePassLrnInput.value = ''; 
            } catch (error) {
                console.error("Error generating late pass: ", error);
                latePassErrorEl.textContent = getFirestoreErrorMessage(error, 'Could not generate a late pass.');
            } finally {
                generateLatePassBtn.disabled = false;
            }
        });
    }

    const connectedCountEl = document.getElementById('connected-count');
    const totalStudentsCountEl = document.getElementById('total-students-count');
    const liveFeedTbody = document.getElementById('live-feed-tbody');

    async function loadSelectedLiveSection() {
        const sectionId = liveSectionSelect?.value;
        activeSessionId = null;
        activeSessionCodeEl.textContent = '------';
        generateRoomCodeBtn.style.display = 'inline-flex';
        copyRoomCodeBtn.style.display = 'none';
        endRoomSessionBtn.style.display = 'none';
        if (unsubscribeLiveFeed) {
            unsubscribeLiveFeed();
            unsubscribeLiveFeed = null;
        }
        livePresenceSnapshot = null;
        renderLivePresence();
        if (!sectionId) return;
        try {
            const sessionsQuery = currentUserRole === 'admin'
                ? query(collection(db, 'sessions'), where('sectionId', '==', sectionId))
                : query(collection(db, 'sessions'), where('sectionId', '==', sectionId), where('teacherUid', '==', currentUser.uid));
            const [sessionsSnap, rosterSnap] = await Promise.all([
                getDocs(sessionsQuery),
                getDocs(collection(db, 'sections', sectionId, 'students'))
            ]);
            totalStudentsCountEl.textContent = rosterSnap.size;
            const currentSession = sessionsSnap.docs
                .filter((sessionDoc) => sessionDoc.data().status === 'active')
                .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0))[0];
            if (!currentSession) return;
            activeSessionId = currentSession.id;
            activeSessionCodeEl.textContent = currentSession.data().code || '------';
            generateRoomCodeBtn.style.display = 'none';
            copyRoomCodeBtn.style.display = 'inline-flex';
            endRoomSessionBtn.style.display = 'inline-flex';
            startLiveRoomListener(sectionId, activeSessionId);
        } catch (error) {
            console.error('Could not load the selected class session:', error);
            liveFeedTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">${escapeHTML(getFirestoreErrorMessage(error, 'Could not load live room status.'))}</td></tr>`;
        }
    }

    async function startLiveRoomListener(sectionId, sessionId) {
        if (unsubscribeLiveFeed) unsubscribeLiveFeed();

        try {
            const rosterQuery = collection(db, 'sections', sectionId, 'students');
            const rosterSnap = await getDocs(rosterQuery);
            totalStudentsCountEl.textContent = rosterSnap.size;
        } catch (error) {
            console.error("Error fetching roster size: ", error);
        }

        const loginsQuery = query(collection(db, 'session_logins'), where('sectionId', '==', sectionId), where('sessionId', '==', sessionId));
        
        unsubscribeLiveFeed = onSnapshot(loginsQuery, (snapshot) => {
            livePresenceSnapshot = snapshot;
            renderLivePresence();
        }, (error) => {
            console.error('Live room listener failed:', error);
            liveFeedTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">${escapeHTML(getFirestoreErrorMessage(error, 'Could not read live room status.'))}</td></tr>`;
        });
    }

    function renderLivePresence() {
        const now = Date.now();
        const onlineStudents = livePresenceSnapshot?.docs
            .map((loginDoc) => ({ id: loginDoc.id, ...loginDoc.data() }))
            .filter((data) => data.online === true && data.lastSeenAt?.toMillis && now - data.lastSeenAt.toMillis() < 90000) ?? [];
        connectedCountEl.textContent = onlineStudents.length;
        if (!onlineStudents.length) {
            liveFeedTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No students are currently playing.</td></tr>';
            return;
        }
        liveFeedTbody.innerHTML = onlineStudents
            .sort((a, b) => String(a.nickname || '').localeCompare(String(b.nickname || '')))
            .map((data) => {
                const timeString = data.lastSeenAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return `<tr><td><span>${escapeHTML(data.nickname || data.lrn || 'Unknown')}</span></td>
                    <td><span>${escapeHTML(data.pcNumber || 'Main Game')}</span></td>
                    <td><span>${escapeHTML(timeString)}</span></td>
                    <td><span class="status-badge badge-success">PLAYING</span></td></tr>`;
            }).join('');
    }

    window.setInterval(renderLivePresence, 15000);

    async function loadAuditLogs() {
        auditLogsCache = [];
        if (!assignedSections.length) {
            renderAuditLogs();
            return true;
        }
        const body = document.getElementById('audit-logs-tbody');
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading audit logs...</td></tr>';
        const namesById = new Map(assignedSections.map((section) => [section.id, section.name]));
        const sectionGroups = [];
        for (let index = 0; index < assignedSections.length; index += 30) {
            sectionGroups.push(assignedSections.slice(index, index + 30).map((section) => section.id));
        }
        try {
            const selectedDate = document.getElementById('audit-date-filter')?.value || '';
            const selectedTime = document.getElementById('audit-time-filter')?.value || 'ALL';
            const snapshots = await Promise.all(sectionGroups.map((sectionIds) => {
                const filters = [where('sectionId', 'in', sectionIds)];
                if (selectedDate) {
                    const start = new Date(`${selectedDate}T00:00:00`);
                    const end = new Date(start);
                    end.setDate(end.getDate() + 1);
                    if (selectedTime === 'AM') end.setHours(12, 0, 0, 0);
                    if (selectedTime === 'PM') start.setHours(12, 0, 0, 0);
                    filters.push(where('timestamp', '>=', Timestamp.fromDate(start)));
                    filters.push(where('timestamp', '<', Timestamp.fromDate(end)));
                }
                filters.push(orderBy('timestamp', 'desc'), limit(100));
                return getDocs(query(collection(db, 'audit_logs'), ...filters));
            }));
            auditLogsCache = snapshots.flatMap((snapshot) => snapshot.docs.map((logDoc) => ({
                id: logDoc.id,
                sectionName: namesById.get(logDoc.data().sectionId) || logDoc.data().sectionName || 'Section',
                ...logDoc.data()
            }))).sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
            renderAuditLogs();
            return true;
        } catch (error) {
            console.error('Could not load audit logs:', error);
            body.innerHTML = `<tr><td colspan="4" style="text-align:center;">${escapeHTML(getFirestoreErrorMessage(error, 'Could not load audit logs.'))}</td></tr>`;
            return false;
        }
    }

    function renderAuditLogs() {
        const body = document.getElementById('audit-logs-tbody');
        if (!body) return;
        const dateFilter = document.getElementById('audit-date-filter')?.value || '';
        const timeFilter = document.getElementById('audit-time-filter')?.value || 'ALL';
        const statusFilter = document.getElementById('audit-status-filter')?.value || 'ALL';
        const visibleLogs = auditLogsCache.filter((log) => {
            const date = log.timestamp?.toDate?.();
            if (!date) return false;
            if (dateFilter && localDateKey(date) !== dateFilter) return false;
            const hour = date.getHours();
            if (timeFilter === 'AM' && hour >= 12) return false;
            if (timeFilter === 'PM' && hour < 12) return false;
            if (statusFilter !== 'ALL' && log.status !== statusFilter) return false;
            return true;
        }).sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
        if (!visibleLogs.length) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center;">No audit logs match these filters.</td></tr>';
            return;
        }
        body.innerHTML = visibleLogs.slice(0, 250).map((log) => {
            const date = log.timestamp.toDate();
            const status = log.status === 'SUCCESS' ? 'SUCCESS' : 'FAIL';
            const statusClass = status === 'SUCCESS' ? 'badge-success' : 'badge-fail';
            return `<tr><td><span>${escapeHTML(log.lrn || '—')} / ${escapeHTML(log.nickname || 'Unknown')}<small class="audit-section-name">${escapeHTML(log.sectionName)}</small></span></td>
                <td><span>${escapeHTML(log.pcNumber || 'Main Game')}</span></td>
                <td><span>${escapeHTML(date.toLocaleString())}</span></td>
                <td><span class="status-badge ${statusClass}">${status}</span></td></tr>`;
        }).join('');
    }

    document.getElementById('audit-date-filter')?.addEventListener('change', async () => {
        auditLogsLoaded = await loadAuditLogs();
    });
    document.getElementById('audit-time-filter')?.addEventListener('change', async () => {
        if (document.getElementById('audit-date-filter')?.value) auditLogsLoaded = await loadAuditLogs();
        else renderAuditLogs();
    });
    document.getElementById('audit-status-filter')?.addEventListener('change', renderAuditLogs);
    document.getElementById('refresh-audit-logs-btn')?.addEventListener('click', async () => {
        auditLogsLoaded = await loadAuditLogs();
    });

    const studentSearchInput = document.getElementById('student-search-input');
    const studentsTableTbody = document.getElementById('students-table-tbody');

    const studentDetailModal = document.getElementById('studentDetailModal');
    const closeStudentModalBtn = document.getElementById('closeStudentModalBtn');
    const modalStudentAvatar = document.getElementById('modal-student-avatar');
    const modalStudentName = document.getElementById('modal-student-name');
    const modalStudentLrn = document.getElementById('modal-student-lrn');
    const modalStudentStarPoints = document.getElementById('modal-student-star-points');
    const modalStudentBadges = document.getElementById('modal-student-badges');
    const studentModalTitle = document.getElementById('student-modal-title');
    const studentProfileView = document.getElementById('student-profile-view');
    const migratedHistorySections = new Set();
    const minigameNames = { market_manager: 'Market Manager', barangay_hall_time_challenge: 'Time Quest' };
    let activeMinigameId = 'market_manager';

    async function ensureMinigameHistoryMigrated(sectionId) {
        if (migratedHistorySections.has(sectionId)) return true;
        try {
            const token = await currentUser.getIdToken();
            const response = await fetch('https://us-central1-didascere-quest-c4f38.cloudfunctions.net/migrateLegacyMinigameHistory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ sectionId })
            });
            const result = await response.json();
            if (!response.ok || result.ok !== true) throw new Error(result.message || `HTTP ${response.status}`);
            migratedHistorySections.add(sectionId);
            return true;
        } catch (error) {
            console.error('Existing minigame history migration failed:', error);
            return false;
        }
    }

    async function loadMinigameResults() {
        const sectionId = document.getElementById('minigame-section-select')?.value;
        const gameId = activeMinigameId;
        const tbody = document.getElementById('minigame-students-tbody');
        const summary = document.getElementById('minigame-summary');
        const historyPanel = document.getElementById('minigame-student-history');
        if (!sectionId || !tbody || !summary) return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading minigame results...</td></tr>';
        if (historyPanel) historyPanel.hidden = true;
        try {
            await ensureMinigameHistoryMigrated(sectionId);
            const [roster, resultSnapshot] = await Promise.all([
                getDocs(collection(db, 'sections', sectionId, 'students')),
                getDocs(query(collection(db, 'sections', sectionId, 'minigameHistory'), where('gameId', '==', gameId)))
            ]);
            const students = new Map(roster.docs.map((item) => [item.id, { lrn: item.id, ...item.data() }]));
            const selectedSetId = document.getElementById('minigame-set-filter')?.value || '';
            const matchesGame = (play) => {
                const recordedGameId = String(play.gameId || '').toLowerCase();
                if (recordedGameId) return recordedGameId === gameId;
                const title = String(play.title || play.game || play.minigame || '').toLowerCase();
                return gameId === 'market_manager'
                    ? title.includes('market')
                    : title.includes('time quest') || title.includes('barangay hall');
            };
            const embeddedHistory = new Map([...students.values()].map((student) => {
                const history = student.minigameHistory
                    ?? student.minigameSessions
                    ?? student.gameHistory
                    ?? student.minigamesPlayed
                    ?? [];
                const plays = Array.isArray(history) ? history
                    .filter((play) => play && typeof play === 'object')
                    .filter(matchesGame)
                    .filter((play) => !selectedSetId || String(play.setId || '') === selectedSetId)
                    .map((play, index) => ({
                        ...play,
                        id: play.id || `embedded_${student.lrn}_${index}`,
                        lrn: String(play.lrn || student.lrn),
                        studentName: play.studentName || student.nickname || student.name || ''
                    })) : [];
                return [student.lrn, plays];
            }));
            const allPlays = resultSnapshot.docs.map((playDoc) => ({ id: playDoc.id, ...playDoc.data() }));
            for (const [lrn, history] of embeddedHistory) {
                allPlays.push(...history);
                for (const play of history) {
                    if (!students.has(lrn)) students.set(lrn, { lrn, nickname: play.studentName || 'Unknown' });
                }
            }
            const visiblePlays = selectedSetId
                ? allPlays.filter((play) => String(play.setId || '') === selectedSetId)
                : allPlays;
            const playsByStudent = new Map();
            for (const play of visiblePlays) {
                const lrn = String(play.lrn || '');
                if (!lrn) continue;
                if (!playsByStudent.has(lrn)) playsByStudent.set(lrn, []);
                playsByStudent.get(lrn).push(play);
                if (!students.has(lrn)) students.set(lrn, { lrn, nickname: play.studentName || 'Unknown' });
            }
            const studentStats = new Map([...students.values()].map((student) => {
                const history = playsByStudent.get(student.lrn) || [];
                return [student.lrn, {
                    plays: history.length,
                    score: history.reduce((sumValue, play) => sumValue + getSessionScore(play), 0),
                    total: history.reduce((sumValue, play) => sumValue + getSessionTotal(play), 0)
                }];
            }));
            const totals = [...studentStats.values()].reduce((result, item) => ({
                studentsPlayed: result.studentsPlayed + Number(item.plays > 0),
                plays: result.plays + item.plays,
                score: result.score + item.score,
                total: result.total + item.total
            }), { studentsPlayed: 0, plays: 0, score: 0, total: 0 });
            const percentage = totals.total ? Math.round(totals.score / totals.total * 100) : 0;
            summary.innerHTML = `<div class="history-stat-card"><span class="history-stat-label">STUDENTS IN SECTION</span><span class="history-stat-value">${students.size}</span></div><div class="history-stat-card"><span class="history-stat-label">STUDENTS PLAYED</span><span class="history-stat-value">${totals.studentsPlayed}</span></div><div class="history-stat-card"><span class="history-stat-label">TOTAL PLAYS</span><span class="history-stat-value">${totals.plays}</span></div><div class="history-stat-card"><span class="history-stat-label">SECTION ACCURACY</span><span class="history-stat-value">${percentage}%</span></div><div class="history-stat-card"><span class="history-stat-label">QUESTIONS ANSWERED</span><span class="history-stat-value">${totals.total}</span></div>`;
            const ordered = [...students.values()].sort((a, b) => String(a.nickname || a.name || a.lrn).localeCompare(String(b.nickname || b.name || b.lrn)));
            tbody.innerHTML = ordered.map((student) => {
                const stats = studentStats.get(student.lrn) || { plays: 0, score: 0, total: 0 };
                const average = stats.total ? `${Math.round(stats.score / stats.total * 100)}% (${stats.score}/${stats.total})` : '—';
                return `<tr><td>${escapeHTML(student.nickname || student.name || 'Unknown')}</td><td>${escapeHTML(student.lrn)}</td><td>${stats.plays}</td><td>${average}</td><td>${stats.plays ? `<button class="pixel-btn btn-secondary minigame-history-open" data-lrn="${escapeHTML(student.lrn)}">View History</button>` : 'No plays'}</td></tr>`;
            }).join('') || '<tr><td colspan="5">No students found in this section.</td></tr>';
            tbody.onclick = (event) => {
                const button = event.target.closest('.minigame-history-open');
                if (!button || !historyPanel) return;
                const lrn = button.dataset.lrn;
                const student = students.get(lrn);
                const history = (playsByStudent.get(lrn) || []).sort((a, b) => (getSessionDateValue(b)?.getTime() || 0) - (getSessionDateValue(a)?.getTime() || 0));
                historyPanel.hidden = false;
                historyPanel.innerHTML = `<h3 class="sub-heading">${escapeHTML(student?.nickname || lrn)} · ${escapeHTML(minigameNames[gameId])} History</h3>${history.map((play) => `<article class="minigame-play-record"><strong>${getSessionScore(play)} / ${getSessionTotal(play)} · ${escapeHTML(String(play.setTitle || play.difficulty || '').toUpperCase())}</strong><span>${escapeHTML(formatSessionDate(play))}</span>${getSessionQuestions(play).map((q, i) => `<p>${i + 1}. ${escapeHTML(q.questionText || 'Question')}<br>Your answer: ${escapeHTML(q.selectedAnswer || 'Not recorded')} · Correct answer: ${escapeHTML(q.correctAnswer || 'Not recorded')} · ${q.isCorrect ? 'Correct' : 'Incorrect'}</p>`).join('')}</article>`).join('') || '<p>No play history found.</p>'}`;
            };
        } catch (error) {
            console.error('Could not load minigame results:', error);
            summary.innerHTML = '';
            tbody.innerHTML = `<tr><td colspan="5">${escapeHTML(getFirestoreErrorMessage(error, 'Could not load minigame results.'))}</td></tr>`;
        }
    }

    function addQuestionEditor(question = {}) {
        const editor = document.getElementById('minigame-question-editor');
        if (!editor) return;
        const index = editor.children.length + 1;
        const row = document.createElement('fieldset');
        row.className = 'question-editor-card';
        row.innerHTML = `<legend>Question ${index}</legend><label class="pixel-label">Question<input class="pixel-input question-prompt" required maxlength="500" value="${escapeHTML(question.question || '')}" placeholder="Enter question" /></label><div class="question-options-grid">${[0,1,2,3].map((i) => `<label>Choice ${i+1}<input class="pixel-input question-option" required maxlength="200" value="${escapeHTML(question.options?.[i] || '')}" /></label>`).join('')}</div><label class="pixel-label">Correct choice<select class="pixel-select question-answer">${[1,2,3,4].map((v) => `<option value="${v-1}" ${Number(question.answer_index) === v-1 ? 'selected' : ''}>Choice ${v}</option>`).join('')}</select></label><button type="button" class="pixel-btn btn-danger remove-question-btn">Remove</button>`;
        row.querySelector('.remove-question-btn').addEventListener('click', () => { if (editor.children.length > 1) row.remove(); });
        editor.append(row);
    }

    async function loadMinigameSets() {
        const sectionId = document.getElementById('minigame-section-select')?.value;
        const gameId = activeMinigameId;
        const list = document.getElementById('minigame-set-list');
        if (!sectionId || !list) { list.innerHTML = '<p>Select a section first.</p>'; return; }
        list.innerHTML = '<p>Loading saved question sets...</p>';
        try {
            const snapshot = await getDocs(query(collection(db, 'sections', sectionId, 'minigameSets'), where('gameId', '==', gameId)));
            const setFilter = document.getElementById('minigame-set-filter');
            if (setFilter) setFilter.innerHTML = `<option value="">All Question Sets</option>${snapshot.docs.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.data().title || 'Question Set')}</option>`).join('')}`;
            list.innerHTML = snapshot.empty ? '<p>No custom sets yet.</p>' : snapshot.docs.map((item) => `<div class="minigame-set-card"><strong>${escapeHTML(item.data().title || 'Question Set')}</strong><span>${Number(item.data().questions?.length) || 0} questions</span></div>`).join('');
        } catch (error) { list.innerHTML = `<p>${escapeHTML(getFirestoreErrorMessage(error, 'Could not load question sets.'))}</p>`; }
    }

    async function saveMinigameSet(event) {
        event.preventDefault();
        const sectionId = document.getElementById('minigame-section-select')?.value;
        const gameId = activeMinigameId;
        const title = document.getElementById('minigame-set-title').value.trim();
        const rows = [...document.querySelectorAll('#minigame-question-editor .question-editor-card')];
        if (!sectionId || !rows.length) { alert('Select a section and add at least one question.'); return; }
        const questions = rows.map((row, index) => ({ id: `q${index + 1}`, question: row.querySelector('.question-prompt').value.trim(), options: [...row.querySelectorAll('.question-option')].map((input) => input.value.trim()), answer_index: Number(row.querySelector('.question-answer').value) }));
        if (questions.length < 10 || questions.length > 50) { alert('Add between 10 and 50 questions so a complete minigame round can draw from the set.'); return; }
        const invalid = questions.some((item) => !item.question || item.options.length !== 4 || item.options.some((option) => !option));
        if (invalid) { alert('Complete each question and all four answer choices.'); return; }
        const button = event.submitter;
        if (button) button.disabled = true;
        try {
            const ref = doc(collection(db, 'sections', sectionId, 'minigameSets'));
            await setDoc(ref, { gameId, title, questions, createdBy: currentUser.uid, createdAt: serverTimestamp(), active: true });
            document.getElementById('minigame-set-form').reset();
            document.getElementById('minigame-question-editor').replaceChildren();
            addQuestionEditor();
            await loadMinigameSets();
        } catch (error) { alert(getFirestoreErrorMessage(error, 'Could not save this question set.')); }
        finally { if (button) button.disabled = false; }
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function createSecureCode(alphabet, length) {
        const randomValues = new Uint32Array(length);
        crypto.getRandomValues(randomValues);
        return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join('');
    }

    function getFirestoreErrorMessage(error, fallback) {
        if (error?.code === 'permission-denied') {
            return 'Firestore rules denied access. Add the dashboard session, late pass, presence, and audit permissions, then publish the rules.';
        }
        if (error?.code === 'unavailable') return 'Firebase is temporarily unavailable. Check your connection and retry.';
        if (error?.code === 'failed-precondition') return 'Firestore needs a composite index for this query, or the index is still building. Deploy firestore.indexes.json and wait for the index to finish building.';
        return fallback;
    }

    function localDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getSessionQuestions(session) {
        const questions = session.questions ?? session.questionResults ?? session.answers ?? session.responses ?? [];
        return Array.isArray(questions) ? questions.filter((question) => question && typeof question === 'object') : [];
    }

    function getSessionScore(session) {
        const score = Number(session.score ?? session.correctAnswers ?? session.correctCount);
        if (Number.isFinite(score)) return Math.max(0, score);
        return getSessionQuestions(session).filter((question) => question.isCorrect === true || question.correct === true).length;
    }

    function getSessionTotal(session) {
        const total = Number(session.totalQuestions ?? session.questionCount ?? session.total);
        if (Number.isFinite(total) && total >= 0) return total;
        return getSessionQuestions(session).length;
    }

    function getSessionDateValue(session) {
        const value = session.playedAt ?? session.completedAt ?? session.createdAt ?? session.timestamp;
        if (value && typeof value.toDate === 'function') return value.toDate();
        if (value && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
        if (typeof value === 'number') return new Date(value < 100000000000 ? value * 1000 : value);
        const parsedDate = value ? new Date(value) : null;
        return parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
    }

    function formatSessionDate(session) {
        const date = getSessionDateValue(session);
        return date ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
    }

    async function fetchAndRenderRoster() {
        const sectionId = rosterSectionSelect.value;
        if (!sectionId) return;

        studentsTableTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Loading students...</td></tr>';

        try {
            const studentsRef = collection(db, 'sections', sectionId, 'students');
            const studentsSnap = await getDocs(studentsRef);
            
            currentStudentsCache = [];
            studentsSnap.forEach(docSnap => {
                currentStudentsCache.push({ lrn: docSnap.id, sectionId, ...docSnap.data() });
            });

            renderFilteredRoster();
        } catch (error) {
            console.error("Error fetching students: ", error);
            studentsTableTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">Failed to load roster.</td></tr>';
        }
    }

    function renderFilteredRoster() {
        if (!studentsTableTbody) return;
        const queryStr = studentSearchInput ? studentSearchInput.value.trim().toLowerCase() : '';

        const filtered = currentStudentsCache.filter(student => {
            return student.lrn.toLowerCase().includes(queryStr) || 
                   (student.nickname && student.nickname.toLowerCase().includes(queryStr));
        });

        if (filtered.length === 0) {
            studentsTableTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No matching students found.</td></tr>';
            return;
        }

        studentsTableTbody.innerHTML = filtered.map(student => `
            <tr>
                <td><span>${student.lrn}</span></td>
                <td><span>${student.nickname || 'Unknown'}</span></td>
                <td><button class="pixel-btn btn-secondary view-student-btn" data-lrn="${student.lrn}">View Full Info</button></td>
            </tr>
        `).join('');
    }

    if (rosterSectionSelect) rosterSectionSelect.addEventListener('change', fetchAndRenderRoster);
    if (studentSearchInput) studentSearchInput.addEventListener('input', renderFilteredRoster);

    if (studentsTableTbody) {
        studentsTableTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('.view-student-btn');
            if (!btn) return;

            const targetLrn = btn.getAttribute('data-lrn');
            const student = currentStudentsCache.find(s => s.lrn === targetLrn);
            if (!student) return;

            studentProfileView.hidden = false;
            studentModalTitle.textContent = 'Student Adventurer Profile';

            if (modalStudentAvatar) modalStudentAvatar.src = student.avatar ? `img/${student.avatar}` : 'img/male.png';
            if (modalStudentName) modalStudentName.textContent = student.nickname || 'Unknown';
            if (modalStudentLrn) modalStudentLrn.textContent = student.lrn;
            if (modalStudentStarPoints) modalStudentStarPoints.textContent = Number(student.coins) || 0;

            if (modalStudentBadges) {
                if (student.badges && student.badges.length > 0) {
                    modalStudentBadges.innerHTML = student.badges.map((badge, idx) => `
                        <div class="achievement-card" id="badge-${student.lrn}-${idx}">
                            <span class="achievement-icon">${badge.icon}</span>
                            <span class="achievement-title">${badge.title}</span>
                            <span class="achievement-type">${badge.type}</span>
                        </div>
                    `).join('');
                } else {
                    modalStudentBadges.innerHTML = `<p style="font-size: 16px; color: #5e4b7a; grid-column: 1 / -1;">No badges earned yet.</p>`;
                }
            }

            if (studentDetailModal) {
                studentDetailModal.classList.add('open');
                studentDetailModal.setAttribute('aria-hidden', 'false');
            }
        });
    }

    const closeStudentModal = () => {
        if (studentDetailModal) {
            studentDetailModal.classList.remove('open');
            studentDetailModal.setAttribute('aria-hidden', 'true');
        }
    };

    if (closeStudentModalBtn) closeStudentModalBtn.addEventListener('click', closeStudentModal);
    if (studentDetailModal) {
        studentDetailModal.addEventListener('click', (e) => {
            if (e.target === studentDetailModal) closeStudentModal();
        });
    }

    const teacherAvatarBtn = document.getElementById('teacherAvatarBtn');
    const avatarSelectorModal = document.getElementById('avatarSelectorModal');
    const closeAvatarModalBtn = document.getElementById('closeAvatarModalBtn');
    const confirmAvatarBtn = document.getElementById('confirmAvatarBtn');
    const avatarChoiceCards = document.querySelectorAll('.avatar-choice-card');

    let pendingAvatarSrc = 'img/male.png';

    if (teacherAvatarBtn) {
        teacherAvatarBtn.addEventListener('click', () => {
            pendingAvatarSrc = teacherAvatarImg ? teacherAvatarImg.getAttribute('src') : 'img/male.png';
            avatarChoiceCards.forEach(card => {
                const cardAvatar = card.getAttribute('data-avatar');
                const isMatch = cardAvatar === pendingAvatarSrc;
                card.classList.toggle('selected', isMatch);
                const radio = card.querySelector('input');
                if (radio) radio.checked = isMatch;
            });

            if (avatarSelectorModal) {
                avatarSelectorModal.classList.add('open');
                avatarSelectorModal.setAttribute('aria-hidden', 'false');
            }
        });
    }

    avatarChoiceCards.forEach(card => {
        card.addEventListener('click', () => {
            avatarChoiceCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            pendingAvatarSrc = card.getAttribute('data-avatar');
        });
    });

    if (confirmAvatarBtn) {
        confirmAvatarBtn.addEventListener('click', () => {
            if (teacherAvatarImg) teacherAvatarImg.src = pendingAvatarSrc;
            if (avatarSelectorModal) {
                avatarSelectorModal.classList.remove('open');
                avatarSelectorModal.setAttribute('aria-hidden', 'true');
            }
        });
    }

    const closeAvatarModal = () => {
        if (avatarSelectorModal) {
            avatarSelectorModal.classList.remove('open');
            avatarSelectorModal.setAttribute('aria-hidden', 'true');
        }
    };

    if (closeAvatarModalBtn) closeAvatarModalBtn.addEventListener('click', closeAvatarModal);
    if (avatarSelectorModal) {
        avatarSelectorModal.addEventListener('click', (e) => {
            if (e.target === avatarSelectorModal) closeAvatarModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeStudentModal();
            closeAvatarModal();
        }
    });
});
