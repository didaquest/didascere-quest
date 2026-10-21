import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, addDoc, setDoc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let unsubscribeAuditLogs = [];
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

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');

            navTabs.forEach(t => t.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetPanel = document.getElementById(targetId);
            if (targetPanel) {
                targetPanel.classList.add('active');
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
            if (liveSectionSelect) liveSectionSelect.addEventListener('change', () => loadSelectedLiveSection());
            if (sectionsSnap.size === 1 && liveSectionSelect) {
                liveSectionSelect.value = sectionsSnap.docs[0].id;
                await loadSelectedLiveSection();
            }
            subscribeToAuditLogs();

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

    async function subscribeToAuditLogs() {
        unsubscribeAuditLogs.forEach((unsubscribe) => unsubscribe());
        unsubscribeAuditLogs = [];
        auditLogsCache = [];
        if (!assignedSections.length) return renderAuditLogs();
        const body = document.getElementById('audit-logs-tbody');
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading audit logs...</td></tr>';
        for (const section of assignedSections) {
            const logsQuery = query(collection(db, 'audit_logs'), where('sectionId', '==', section.id));
            const unsubscribe = onSnapshot(logsQuery, (snapshot) => {
                auditLogsCache = auditLogsCache.filter((log) => log.sectionId !== section.id);
                snapshot.forEach((logDoc) => auditLogsCache.push({ id: logDoc.id, sectionName: section.name, ...logDoc.data() }));
                renderAuditLogs();
            }, (error) => {
                console.error(`Could not read audit logs for ${section.name}:`, error);
                body.innerHTML = `<tr><td colspan="4" style="text-align:center;">${escapeHTML(getFirestoreErrorMessage(error, 'Could not load audit logs.'))}</td></tr>`;
            });
            unsubscribeAuditLogs.push(unsubscribe);
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

    ['audit-date-filter', 'audit-time-filter', 'audit-status-filter'].forEach((id) => {
        document.getElementById(id)?.addEventListener('change', renderAuditLogs);
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
    const studentHistoryView = document.getElementById('student-history-view');
    const studentSessionView = document.getElementById('student-session-view');
    const viewStudentHistoryBtn = document.getElementById('view-student-history-btn');
    const historyBackProfileBtn = document.getElementById('history-back-profile-btn');
    const historyBackListBtn = document.getElementById('history-back-list-btn');
    const studentHistoryName = document.getElementById('student-history-name');
    const studentHistoryStats = document.getElementById('student-history-stats');
    const studentMinigameList = document.getElementById('student-minigame-list');
    const studentSessionDate = document.getElementById('student-session-date');
    const studentSessionSummary = document.getElementById('student-session-summary');
    const studentSessionQuestions = document.getElementById('student-session-questions');
    let activeHistoryStudent = null;
    let activeStudentSessions = [];
    const questionBankCache = new Map();

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
        return fallback;
    }

    function localDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getStudentSessions(student) {
        const sessions = student.minigameHistory
            ?? student.minigameSessions
            ?? student.gameHistory
            ?? student.minigamesPlayed
            ?? [];
        return Array.isArray(sessions) ? sessions.filter((session) => session && typeof session === 'object') : [];
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

    function getSessionTitle(session) {
        const title = session.title ?? session.minigameName ?? session.gameName ?? session.minigame ?? session.game ?? '';
        if (title) return String(title);
        const id = String(session.minigameId ?? session.gameId ?? '').toLowerCase();
        if (id.includes('market')) return 'Market Manager';
        if (id.includes('time') || id.includes('barangay')) return 'Time Quest';
        return 'Minigame';
    }

    function getQuestionBankKey(session) {
        const id = String(session.minigameId ?? session.gameId ?? getSessionTitle(session)).toLowerCase().replace(/[^a-z0-9]+/g, '');
        const title = getSessionTitle(session).toLowerCase();
        const difficultyInput = String(session.difficulty ?? 'normal').toLowerCase().replace(/\s+/g, '_');
        const isTimeQuest = id.includes('time') || id.includes('barangay') || title.includes('time quest') || title.includes('time challenge');
        const isMarketManager = id.includes('market') || title.includes('market manager');
        if (!isTimeQuest && !isMarketManager) return '';

        let difficulty = difficultyInput.replace(/^custom-/, 'custom_');
        if (isTimeQuest && difficulty === 'normal') difficulty = 'medium';
        if (isMarketManager && difficulty === 'medium') difficulty = 'normal';
        const allowedDifficulties = isTimeQuest
            ? ['easy', 'medium', 'hard', 'custom_easy', 'custom_medium', 'custom_hard']
            : ['easy', 'normal', 'hard'];
        if (!allowedDifficulties.includes(difficulty)) difficulty = isTimeQuest ? 'medium' : 'normal';
        return isTimeQuest ? `timequest_${difficulty}` : `marketmanager_${difficulty}`;
    }

    async function loadQuestionBank(session) {
        const bankKey = getQuestionBankKey(session);
        if (!bankKey) return [];
        if (!questionBankCache.has(bankKey)) {
            questionBankCache.set(bankKey, fetch(`data/question-bank/${bankKey}.json`)
                .then((response) => {
                    if (!response.ok) throw new Error(`Question bank ${bankKey} could not be loaded.`);
                    return response.json();
                })
                .then((data) => Array.isArray(data.questions) ? data.questions : [])
                .catch((error) => {
                    console.error('Question bank lookup failed:', error);
                    return [];
                }));
        }
        return questionBankCache.get(bankKey);
    }

    function getQuestionReference(questionRecord, bankQuestions) {
        const questionId = questionRecord.questionId ?? questionRecord.id ?? questionRecord.question_id;
        if (questionId == null) return null;
        return bankQuestions.find((question) => String(question.id) === String(questionId)) ?? null;
    }

    function getAnswerText(value, options) {
        if (typeof value === 'number') return options[value] == null ? 'Not recorded' : options[value];
        return value == null || value === '' ? 'Not recorded' : String(value);
    }

    async function renderSessionDetails(session) {
        const bankQuestions = await loadQuestionBank(session);
        const questions = getSessionQuestions(session);
        const score = getSessionScore(session);
        const total = getSessionTotal(session);
        document.getElementById('student-session-heading').textContent = getSessionTitle(session);
        studentModalTitle.textContent = getSessionTitle(session);
        studentSessionDate.textContent = formatSessionDate(session);
        studentSessionSummary.innerHTML = `
            <span class="session-summary-item"><strong>Difficulty:</strong> ${escapeHTML(session.difficulty ?? 'Not recorded')}</span>
            <span class="session-summary-item"><strong>Score:</strong> ${score} / ${total}</span>
            <span class="session-summary-item"><strong>Correct:</strong> ${score}</span>
            <span class="session-summary-item"><strong>Wrong:</strong> ${Math.max(0, total - score)}</span>
            <span class="session-summary-item"><strong>Played:</strong> ${escapeHTML(formatSessionDate(session))}</span>`;

        if (!questions.length) {
            studentSessionQuestions.innerHTML = '<p class="history-empty-state">Question by question answers were not recorded for this play session.</p>';
        } else {
            studentSessionQuestions.innerHTML = questions.map((questionRecord, questionIndex) => {
                const reference = getQuestionReference(questionRecord, bankQuestions);
                const recordedOptions = Array.isArray(questionRecord.options) ? questionRecord.options : [];
                const correctOptions = recordedOptions.length ? recordedOptions : (reference?.options ?? []);
                const questionText = questionRecord.questionText ?? questionRecord.prompt ?? questionRecord.question ?? questionRecord.text ?? reference?.question ?? `Question ${questionIndex + 1}`;
                const selectedValue = questionRecord.selectedAnswer ?? questionRecord.selectedOption ?? questionRecord.chosenAnswer ?? questionRecord.playerAnswer ?? questionRecord.answerGiven ?? questionRecord.userAnswer ?? questionRecord.selectedAnswerIndex ?? questionRecord.selectedOptionIndex ?? questionRecord.selectedIndex;
                const selectedAnswer = typeof selectedValue === 'number' && !recordedOptions.length
                    ? 'Not recorded'
                    : getAnswerText(selectedValue, recordedOptions);
                const correctIndexValue = questionRecord.correctIndex ?? questionRecord.correctAnswerIndex ?? questionRecord.correctOptionIndex ?? questionRecord.answer_index;
                const correctIndex = correctIndexValue == null
                    ? (recordedOptions.length ? null : reference?.answer_index)
                    : Number(correctIndexValue);
                const correctAnswer = questionRecord.correctAnswer ?? questionRecord.correctOption ?? questionRecord.expectedAnswer ?? getAnswerText(correctIndex, correctOptions);
                const selectedIndex = Number(questionRecord.selectedIndex ?? questionRecord.selectedAnswerIndex ?? questionRecord.selectedOptionIndex);
                const optionsMarkup = correctOptions.length
                    ? `<ul class="session-choice-list">${correctOptions.map((option, optionIndex) => {
                        const isSelected = Number.isInteger(selectedIndex)
                            ? optionIndex === selectedIndex
                            : String(option) === String(selectedAnswer);
                        const isAnswer = correctIndex != null
                            ? optionIndex === Number(correctIndex)
                            : String(option) === String(correctAnswer);
                        const choiceClasses = [
                            'session-choice',
                            isSelected ? 'is-player-choice' : '',
                            isAnswer ? 'is-correct-choice' : ''
                        ].filter(Boolean).join(' ');
                        const choiceTags = [
                            isSelected ? 'Player choice' : '',
                            isAnswer ? 'Correct answer' : ''
                        ].filter(Boolean).join(' · ');
                        return `<li class="${choiceClasses}"><span>${escapeHTML(String(option))}</span>${choiceTags ? `<strong>${escapeHTML(choiceTags)}</strong>` : ''}</li>`;
                    }).join('')}</ul>`
                    : '<p class="session-answer-line">Choices were not recorded for this question.</p>';
                const hasCorrectFlag = typeof questionRecord.isCorrect === 'boolean' || typeof questionRecord.correct === 'boolean';
                const isCorrect = typeof questionRecord.isCorrect === 'boolean'
                    ? questionRecord.isCorrect
                    : typeof questionRecord.correct === 'boolean'
                        ? questionRecord.correct
                        : selectedAnswer !== 'Not recorded' && correctAnswer !== 'Not recorded'
                            ? String(selectedAnswer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase()
                            : false;
                const hasAnswerData = (selectedAnswer !== 'Not recorded' && correctAnswer !== 'Not recorded') || hasCorrectFlag;
                const cardClass = !hasAnswerData ? 'is-unrecorded' : isCorrect ? 'is-correct' : 'is-incorrect';
                const resultLabel = !hasAnswerData ? 'ANSWER DETAILS NOT RECORDED' : isCorrect ? 'CORRECT' : 'INCORRECT';
                return `
                    <article class="session-question-card ${cardClass}">
                        <p class="session-question-heading">Question ${questionIndex + 1}</p>
                        <p class="session-question-text">${escapeHTML(questionText)}</p>
                        <p class="session-answer-line"><strong>Choices:</strong></p>
                        ${optionsMarkup}
                        <p class="session-answer-line"><strong>Player answer:</strong> ${escapeHTML(selectedAnswer)}</p>
                        <p class="session-answer-line"><strong>Correct answer:</strong> ${escapeHTML(correctAnswer)}</p>
                        <span class="session-result-badge">${resultLabel}</span>
                    </article>`;
            }).join('');
        }

        studentHistoryView.hidden = true;
        studentSessionView.hidden = false;
    }

    function renderStudentHistory(student) {
        activeHistoryStudent = student;
        activeStudentSessions = getStudentSessions(student).slice()
            .sort((a, b) => (getSessionDateValue(b)?.getTime() ?? 0) - (getSessionDateValue(a)?.getTime() ?? 0));
        const questionTotal = activeStudentSessions.reduce((sum, session) => sum + getSessionTotal(session), 0);
        const correctTotal = activeStudentSessions.reduce((sum, session) => sum + getSessionScore(session), 0);
        const accuracy = questionTotal ? Math.round(correctTotal / questionTotal * 100) : 0;
        studentHistoryName.textContent = student.nickname || student.displayName || student.lrn || 'Student';
        studentHistoryStats.innerHTML = `
            <div class="history-stat-card"><span class="history-stat-label">STAR POINTS</span><span class="history-stat-value">${Number(student.coins) || 0}</span></div>
            <div class="history-stat-card"><span class="history-stat-label">ACHIEVEMENTS</span><span class="history-stat-value">${Array.isArray(student.badges) ? student.badges.length : 0}</span></div>
            <div class="history-stat-card"><span class="history-stat-label">MINIGAMES PLAYED</span><span class="history-stat-value">${activeStudentSessions.length}</span></div>
            <div class="history-stat-card"><span class="history-stat-label">QUESTIONS ANSWERED</span><span class="history-stat-value">${questionTotal}</span></div>
            <div class="history-stat-card"><span class="history-stat-label">OVERALL ACCURACY</span><span class="history-stat-value">${accuracy}%</span></div>`;

        if (!activeStudentSessions.length) {
            studentMinigameList.innerHTML = '<p class="history-empty-state">No minigame history is recorded for this student yet.</p>';
            return;
        }
        studentMinigameList.innerHTML = activeStudentSessions.map((session, index) => `
            <button type="button" class="minigame-history-card" data-session-index="${index}">
                <span><span class="minigame-history-title">${escapeHTML(getSessionTitle(session))}</span>
                <span class="minigame-history-meta">${escapeHTML(String(session.difficulty ?? 'Difficulty unavailable').toUpperCase())} · ${escapeHTML(formatSessionDate(session))}</span></span>
                <span class="minigame-history-score">${getSessionScore(session)} / ${getSessionTotal(session)}</span>
            </button>`).join('');
    }

    if (viewStudentHistoryBtn) {
        viewStudentHistoryBtn.addEventListener('click', async () => {
            if (!activeHistoryStudent) return;
            studentProfileView.hidden = true;
            studentSessionView.hidden = true;
            studentHistoryView.hidden = false;
            studentModalTitle.textContent = 'Overall Adventure Data';
            if (activeHistoryStudent.minigameHistoryLoaded === true) {
                renderStudentHistory(activeHistoryStudent);
                return;
            }
            studentMinigameList.innerHTML = '<p class="history-empty-state">Loading minigame history...</p>';
            try {
                const historyRef = collection(db, 'sections', activeHistoryStudent.sectionId, 'students', activeHistoryStudent.lrn, 'minigameHistory');
                const historySnapshot = await getDocs(historyRef);
                activeHistoryStudent.minigameHistory = historySnapshot.docs.map((historyDoc) => ({ id: historyDoc.id, ...historyDoc.data() }));
                activeHistoryStudent.minigameHistoryLoaded = true;
            } catch (error) {
                console.error('Could not load minigame history:', error);
                activeHistoryStudent.minigameHistory = [];
                const detail = error?.code === 'permission-denied'
                    ? 'Firestore denied access. Add and publish the minigameHistory read rule for this teacher.'
                    : `Firestore history read failed: ${error?.code || error?.message || 'unknown error'}`;
                studentMinigameList.innerHTML = `<p class="history-empty-state">${escapeHTML(detail)}</p>`;
                studentHistoryStats.innerHTML = '';
                return;
            }
            renderStudentHistory(activeHistoryStudent);
        });
    }

    if (historyBackProfileBtn) {
        historyBackProfileBtn.addEventListener('click', () => {
            studentHistoryView.hidden = true;
            studentSessionView.hidden = true;
            studentProfileView.hidden = false;
            studentModalTitle.textContent = 'Student Adventurer Profile';
        });
    }

    if (historyBackListBtn) {
        historyBackListBtn.addEventListener('click', () => {
            studentSessionView.hidden = true;
            studentHistoryView.hidden = false;
            studentModalTitle.textContent = 'Overall Adventure Data';
        });
    }

    if (studentMinigameList) {
        studentMinigameList.addEventListener('click', (event) => {
            const card = event.target.closest('.minigame-history-card');
            if (!card) return;
            const sessionIndex = Number(card.dataset.sessionIndex);
            const session = activeStudentSessions[sessionIndex];
            if (session) renderSessionDetails(session);
        });
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

            activeHistoryStudent = student;
            studentProfileView.hidden = false;
            studentHistoryView.hidden = true;
            studentSessionView.hidden = true;
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
