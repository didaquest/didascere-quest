import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, where, getDocs, limit, orderBy, addDoc, setDoc, onSnapshot, serverTimestamp, Timestamp, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let editingMinigameSetId = null;
let editingMinigameSetSourceSectionId = null;
let minigameSetMetadata = new Map();
let latestMinigameReportData = null;
let activeMinigameSummaryData = null;

document.addEventListener('DOMContentLoaded', () => {

    const teacherNameEl = document.getElementById('teacher-name');
    const teacherSectionEl = document.getElementById('teacher-section');
    const teacherAvatarImg = document.getElementById('teacher-avatar-img');
    const liveSectionSelect = document.getElementById('live-section-select');
    const rosterSectionSelect = document.getElementById('roster-section-select');
    const logoutButtons = [document.getElementById('logout-btn'), document.getElementById('mobile-logout-btn')].filter(Boolean);
    const studentHistoryPanel = document.getElementById('minigame-student-history');
    const summaryReportPanel = document.getElementById('minigame-summary-report');
    const closeStudentHistoryPanel = () => {
        if (!studentHistoryPanel) return;
        studentHistoryPanel.hidden = true;
        studentHistoryPanel.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('student-history-open');
    };
    studentHistoryPanel?.addEventListener('click', (event) => {
        if (event.target === studentHistoryPanel || event.target.closest('.student-history-close')) closeStudentHistoryPanel();
    });
    const closeSummaryReport = () => {
        if (!summaryReportPanel) return;
        summaryReportPanel.hidden = true;
        summaryReportPanel.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('student-history-open');
    };
    summaryReportPanel?.addEventListener('click', (event) => {
        if (event.target === summaryReportPanel) closeSummaryReport();
    });
    document.getElementById('close-minigame-summary-report')?.addEventListener('click', closeSummaryReport);
    document.getElementById('print-minigame-summary-report')?.addEventListener('click', () => window.print());
    document.getElementById('download-minigame-summary-report')?.addEventListener('click', downloadMinigameSummaryCSV);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && studentHistoryPanel && !studentHistoryPanel.hidden) closeStudentHistoryPanel();
        if (event.key === 'Escape' && summaryReportPanel && !summaryReportPanel.hidden) closeSummaryReport();
    });
    document.querySelectorAll('.auto-resize-description').forEach((textarea) => {
        textarea.addEventListener('input', () => {
            textarea.setCustomValidity('');
            resizeDescriptionTextarea(textarea);
        });
        resizeDescriptionTextarea(textarea);
    });

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
            renderMinigameSectionChoices('create-minigame-target-sections');
            renderMinigameSectionChoices('edit-minigame-target-sections');
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
            document.getElementById('minigame-game-select')?.addEventListener('change', async (event) => {
                activeMinigameId = event.currentTarget.value || 'market_manager';
                await loadMinigameSets();
                await loadMinigameResults();
            });
            document.getElementById('minigame-set-filter')?.addEventListener('change', async () => {
                updateSummaryReportAvailability();
                await loadMinigameResults();
            });
            document.getElementById('refresh-minigame-results-btn')?.addEventListener('click', async () => {
                await Promise.all([loadMinigameSets(), loadMinigameResults()]);
                minigameTabLoaded = true;
            });
            document.getElementById('generate-minigame-report-btn')?.addEventListener('click', openMinigameSummaryReport);
            document.getElementById('manage-minigame-btn')?.addEventListener('click', () => {
                const sectionId = minigameSectionSelect?.value || '';
                renderMinigameSectionChoices('create-minigame-target-sections', [sectionId]);
                document.getElementById('minigame-results-view').hidden = true;
                document.getElementById('manage-minigame-panel').hidden = false;
                resizeDescriptionTextarea(document.getElementById('minigame-set-description'));
            });
            document.getElementById('close-manage-minigame-btn')?.addEventListener('click', () => {
                document.getElementById('edit-minigame-panel').hidden = true;
                document.getElementById('manage-minigame-panel').hidden = true;
                document.getElementById('minigame-results-view').hidden = false;
            });
            document.getElementById('add-minigame-question-btn')?.addEventListener('click', () => addQuestionEditor());
            document.getElementById('add-edit-minigame-question-btn')?.addEventListener('click', () => addQuestionEditor({}, 'edit-minigame-question-editor'));
            document.getElementById('minigame-set-form')?.addEventListener('submit', saveMinigameSet);
            const editSetForm = document.getElementById('edit-minigame-set-form');
            const updateConfirmModal = document.getElementById('confirm-question-update-modal');
            const closeUpdateConfirm = () => {
                updateConfirmModal.classList.remove('open');
                updateConfirmModal.setAttribute('aria-hidden', 'true');
            };
            editSetForm?.addEventListener('submit', (event) => {
                if (editSetForm.dataset.updateConfirmed !== 'true') {
                    event.preventDefault();
                    updateConfirmModal.classList.add('open');
                    updateConfirmModal.setAttribute('aria-hidden', 'false');
                    document.getElementById('cancel-question-update-btn').focus();
                    return;
                }
                delete editSetForm.dataset.updateConfirmed;
                saveMinigameSet(event);
            });
            document.getElementById('cancel-question-update-btn')?.addEventListener('click', closeUpdateConfirm);
            document.getElementById('submit-question-update-btn')?.addEventListener('click', () => {
                closeUpdateConfirm();
                editSetForm.dataset.updateConfirmed = 'true';
                editSetForm.requestSubmit(editSetForm.querySelector('button[type="submit"]'));
            });
            updateConfirmModal?.addEventListener('click', (event) => {
                if (event.target === updateConfirmModal) closeUpdateConfirm();
            });
            document.getElementById('back-to-manage-minigame-btn')?.addEventListener('click', () => {
                document.getElementById('edit-minigame-panel').hidden = true;
            });
            document.getElementById('minigame-set-list')?.addEventListener('click', handleMinigameSetAction);
            addQuestionEditor();
        } catch (error) {
            console.error("Error verifying user data: ", error);
            await signOut(auth);
            window.location.href = 'login.html';
        }
    });

    logoutButtons.forEach((logoutBtn) => {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut(auth).then(() => window.location.href = 'login.html');
        });
    });

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
                    <td><span>${escapeHTML(data.pcName || data.pcNumber || 'Unknown PC')}</span></td>
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
            return `<tr><td data-label="LRN / Student"><span>${escapeHTML(log.lrn || '—')} / ${escapeHTML(log.nickname || 'Unknown')}<small class="audit-section-name">${escapeHTML(log.sectionName)}</small></span></td>
                <td data-label="PC Name"><span>${escapeHTML(log.pcName || log.pcNumber || 'Unknown PC')}</span></td>
                <td data-label="Timestamp"><span>${escapeHTML(date.toLocaleString())}</span></td>
                <td data-label="Status"><span class="status-badge ${statusClass}">${status}</span></td></tr>`;
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
        latestMinigameReportData = null;
        const sectionId = document.getElementById('minigame-section-select')?.value;
        const gameId = activeMinigameId;
        const tbody = document.getElementById('minigame-students-tbody');
        const summary = document.getElementById('minigame-summary');
        const historyPanel = studentHistoryPanel;
        if (!sectionId || !tbody || !summary) return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading minigame results...</td></tr>';
        if (historyPanel) closeStudentHistoryPanel();
        try {
            const historyMigrated = await ensureMinigameHistoryMigrated(sectionId);
            const [roster, resultSnapshot] = await Promise.all([
                getDocs(collection(db, 'sections', sectionId, 'students')),
                getDocs(query(collection(db, 'sections', sectionId, 'minigameHistory'), where('gameId', '==', gameId)))
            ]);
            const students = new Map(roster.docs.map((item) => [item.id, { lrn: item.id, ...item.data() }]));
            const selectedSetId = document.getElementById('minigame-set-filter')?.value || '';
            const matchesGame = (play) => {
                const recordedGameId = String(play.gameId || '').toLowerCase();
                const normalizedGameId = recordedGameId.replace(/[\s-]+/g, '_');
                if (normalizedGameId === gameId) return true;
                const title = String(play.title || play.game || play.minigame || '').toLowerCase();
                return gameId === 'market_manager'
                    ? normalizedGameId.includes('market') || title.includes('market')
                    : normalizedGameId.includes('time_quest') || normalizedGameId.includes('barangay_hall') || title.includes('time quest') || title.includes('barangay hall');
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
            // Fall back to legacy per-student records when migration failed or this game has no
            // section-level records yet. Once results exist centrally, normal loads stay lean.
            if (!historyMigrated || resultSnapshot.empty) {
                const legacySnapshots = await Promise.all(roster.docs.map((studentDoc) => getDocs(
                    collection(db, 'sections', sectionId, 'students', studentDoc.id, 'minigameHistory')
                )));
                legacySnapshots.forEach((snapshot, studentIndex) => {
                    const studentDoc = roster.docs[studentIndex];
                    snapshot.docs.forEach((playDoc) => {
                        const play = {
                            ...playDoc.data(),
                            id: playDoc.id,
                            lrn: studentDoc.id,
                            studentName: playDoc.data().studentName || studentDoc.data().nickname || studentDoc.data().name || ''
                        };
                        if (matchesGame(play)) allPlays.push(play);
                    });
                });
            }
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
            const sectionSelect = document.getElementById('minigame-section-select');
            const setSelect = document.getElementById('minigame-set-filter');
            latestMinigameReportData = {
                sectionId,
                sectionName: sectionSelect?.selectedOptions?.[0]?.textContent || sectionId,
                gameId,
                gameName: minigameNames[gameId] || gameId,
                selectedSetId,
                setTitle: selectedSetId ? (minigameSetMetadata.get(selectedSetId)?.title || setSelect?.selectedOptions?.[0]?.textContent || '') : 'All Custom Question Sets',
                students: ordered.map((student) => ({
                    lrn: student.lrn,
                    name: student.nickname || student.name || 'Unknown',
                    ...(studentStats.get(student.lrn) || { plays: 0, score: 0, total: 0 }),
                    playHistory: playsByStudent.get(student.lrn) || []
                }))
            };
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
                const stats = studentStats.get(lrn) || { plays: 0, score: 0, total: 0 };
                const accuracy = stats.total ? Math.round(stats.score / stats.total * 100) : 0;
                historyPanel.hidden = false;
                historyPanel.setAttribute('aria-hidden', 'false');
                document.body.classList.add('student-history-open');
                historyPanel.innerHTML = `<div class="pixel-card student-history-modal"><div class="controls-bar student-history-modal-header"><div><h3 id="minigame-student-history-title" class="card-heading">${escapeHTML(student?.nickname || lrn)} · ${escapeHTML(minigameNames[gameId])} History</h3><p class="modal-subtitle">Student performance for the selected minigame${selectedSetId ? ' and question set' : ''}.</p></div><button type="button" class="pixel-btn btn-secondary student-history-close">Close</button></div><div class="student-history-stats"><div class="history-stat-card"><span class="history-stat-label">TOTAL PLAYS</span><span class="history-stat-value">${stats.plays}</span></div><div class="history-stat-card"><span class="history-stat-label">CORRECT ANSWERS</span><span class="history-stat-value">${stats.score} / ${stats.total}</span></div><div class="history-stat-card"><span class="history-stat-label">QUESTIONS ANSWERED</span><span class="history-stat-value">${stats.total}</span></div><div class="history-stat-card"><span class="history-stat-label">OVERALL ACCURACY</span><span class="history-stat-value">${accuracy}%</span></div></div>${history.map((play) => `<article class="minigame-play-record"><strong>${getSessionScore(play)} / ${getSessionTotal(play)} · ${escapeHTML(String(play.setTitle || play.difficulty || '').toUpperCase())}</strong><span>${escapeHTML(formatSessionDate(play))}</span>${getSessionQuestions(play).map((q, i) => {
                    const isCorrect = q.isCorrect === true || q.correct === true;
                    const options = Array.isArray(q.options) ? q.options : [];
                    const selectedIndex = Number(q.selectedIndex);
                    const correctIndex = Number(q.correctIndex);
                    const choiceList = options.map((option, optionIndex) => {
                        const correctChoice = optionIndex === correctIndex || (q.correctIndex === undefined && String(option) === String(q.correctAnswer));
                        const selectedChoice = optionIndex === selectedIndex;
                        const choiceClass = correctChoice ? 'history-answer-correct' : (selectedChoice ? 'history-answer-incorrect' : '');
                        const badge = correctChoice ? (selectedChoice ? 'Your choice · Correct' : 'Correct answer') : (selectedChoice ? 'Your choice' : '');
                        return `<li class="history-choice ${choiceClass}"><span class="history-choice-label">${String.fromCharCode(65 + optionIndex)}.</span><span>${escapeHTML(option)}</span>${badge ? `<small class="history-choice-badge">${badge}</small>` : ''}</li>`;
                    }).join('');
                    return `<div class="history-question"><strong class="history-question-prompt">${i + 1}. ${escapeHTML(q.questionText || 'Question')}</strong>${choiceList ? `<ul class="history-choice-list">${choiceList}</ul>` : ''}<div class="history-answer-lines"><span class="history-answer ${isCorrect ? 'history-answer-correct' : 'history-answer-incorrect'}">Your answer: ${escapeHTML(q.selectedAnswer || 'Not recorded')}</span><span class="history-answer history-answer-correct">Correct answer: ${escapeHTML(q.correctAnswer || 'Not recorded')}</span><span class="history-result ${isCorrect ? 'history-answer-correct' : 'history-answer-incorrect'}">${isCorrect ? 'Correct' : 'Incorrect'}</span></div></div>`;
                }).join('')}</article>`).join('') || '<p>No play history found.</p>'}</div>`;
            };
        } catch (error) {
            latestMinigameReportData = null;
            console.error('Could not load minigame results:', error);
            summary.innerHTML = '';
            tbody.innerHTML = `<tr><td colspan="5">${escapeHTML(getFirestoreErrorMessage(error, 'Could not load minigame results.'))}</td></tr>`;
        }
    }

    function buildMinigameSummaryReport(data) {
        const students = data.students.map((student) => {
            const competencies = new Map();
            student.playHistory.forEach((play) => {
                const setId = String(play.setId || '');
                const metadata = minigameSetMetadata.get(setId);
                // Only sets currently published for this section are custom question sets.
                if (!setId || !metadata) return;
                const competency = String(metadata.description || metadata.title || play.setTitle || 'Unnamed competency').trim();
                if (!competencies.has(competency)) competencies.set(competency, { name: competency, correct: 0, total: 0, items: new Map() });
                const stats = competencies.get(competency);
                const questions = getSessionQuestions(play);
                if (questions.length) {
                    questions.forEach((question) => {
                        const correct = question.isCorrect === true || question.correct === true;
                        stats.total += 1;
                        stats.correct += Number(correct);
                        const itemName = String(question.questionText || question.prompt || question.question || '').trim();
                        if (itemName) {
                            if (!stats.items.has(itemName)) stats.items.set(itemName, { name: itemName, correct: 0, total: 0 });
                            const item = stats.items.get(itemName);
                            item.total += 1;
                            item.correct += Number(correct);
                        }
                    });
                } else {
                    stats.correct += getSessionScore(play);
                    stats.total += getSessionTotal(play);
                }
            });
            const competencyList = [...competencies.values()].map((item) => ({
                ...item,
                accuracy: item.total ? Math.round(item.correct / item.total * 100) : 0
            })).sort((a, b) => a.accuracy - b.accuracy || a.name.localeCompare(b.name));
            return {
                ...student,
                accuracy: student.total ? Math.round(student.score / student.total * 100) : 0,
                competencies: competencyList.map((item) => ({
                    ...item,
                    items: [...item.items.values()].map((question) => ({
                        ...question,
                        accuracy: question.total ? Math.round(question.correct / question.total * 100) : 0
                    })).sort((a, b) => a.accuracy - b.accuracy || a.name.localeCompare(b.name))
                }))
            };
        });
        const competencyMap = new Map();
        students.forEach((student) => student.competencies.forEach((item) => {
            if (!competencyMap.has(item.name)) competencyMap.set(item.name, { name: item.name, correct: 0, total: 0, items: new Map() });
            const aggregate = competencyMap.get(item.name);
            aggregate.correct += item.correct;
            aggregate.total += item.total;
            item.items.forEach((question) => {
                if (!aggregate.items.has(question.name)) aggregate.items.set(question.name, { name: question.name, correct: 0, total: 0 });
                const aggregateQuestion = aggregate.items.get(question.name);
                aggregateQuestion.correct += question.correct;
                aggregateQuestion.total += question.total;
            });
        }));
        const competencies = [...competencyMap.values()].map((item) => ({
            ...item,
            accuracy: item.total ? Math.round(item.correct / item.total * 100) : 0,
            items: [...item.items.values()].map((question) => ({
                ...question,
                accuracy: question.total ? Math.round(question.correct / question.total * 100) : 0
            })).sort((a, b) => a.accuracy - b.accuracy || a.name.localeCompare(b.name))
        })).sort((a, b) => a.accuracy - b.accuracy || a.name.localeCompare(b.name));
        return { students, competencies };
    }

    function updateSummaryReportAvailability() {
        const button = document.getElementById('generate-minigame-report-btn');
        const selectedSetId = document.getElementById('minigame-set-filter')?.value || '';
        const canGenerate = Boolean(selectedSetId && minigameSetMetadata.has(selectedSetId));
        if (!button) return;
        button.disabled = !canGenerate;
        button.title = canGenerate ? 'Generate a summary for the selected custom question set' : 'Select a custom question set to generate its summary report';
    }

    function openMinigameSummaryReport() {
        const selectedSetId = document.getElementById('minigame-set-filter')?.value || '';
        if (!selectedSetId || !minigameSetMetadata.has(selectedSetId)) {
            updateSummaryReportAvailability();
            return;
        }
        if (!latestMinigameReportData) {
            alert('Load minigame results for a section first.');
            return;
        }
        const customStudents = latestMinigameReportData.students.map((student) => ({
            ...student,
            playHistory: student.playHistory.filter((play) => play.setId && minigameSetMetadata.has(String(play.setId)))
        })).map((student) => ({
            ...student,
            plays: student.playHistory.length,
            score: student.playHistory.reduce((sum, play) => sum + getSessionScore(play), 0),
            total: student.playHistory.reduce((sum, play) => sum + getSessionTotal(play), 0)
        }));
        const data = { ...latestMinigameReportData, students: customStudents };
        activeMinigameSummaryData = data;
        const report = buildMinigameSummaryReport(data);
        const context = [data.sectionName, data.gameName, data.setTitle].filter(Boolean).join(' · ');
        document.getElementById('minigame-summary-report-context').textContent = context;
        const rosterSize = report.students.length;
        const playedStudents = report.students.filter((student) => student.plays > 0);
        const scoredStudents = playedStudents.filter((student) => student.total > 0);
        const unattemptedStudents = report.students.filter((student) => student.plays === 0);
        const correct = playedStudents.reduce((sum, student) => sum + student.score, 0);
        const total = playedStudents.reduce((sum, student) => sum + student.total, 0);
        const playCount = playedStudents.reduce((sum, student) => sum + student.plays, 0);
        const overallAccuracy = total ? Math.round(correct / total * 100) : 0;
        const participationRate = rosterSize ? Math.round(playedStudents.length / rosterSize * 100) : 0;
        const classAverageAccuracy = scoredStudents.length
            ? Math.round(scoredStudents.reduce((sum, student) => sum + student.score / student.total * 100, 0) / scoredStudents.length)
            : 0;
        const classAverageAccuracyLabel = scoredStudents.length ? `${classAverageAccuracy}%` : '—';
        const overallAccuracyLabel = total ? `${overallAccuracy}%` : '—';
        const tierFor = (accuracy) => accuracy >= 90
            ? { label: 'Mastered', className: 'report-mastered' }
            : accuracy >= 70
                ? { label: 'Progressing', className: 'report-progressing' }
                : { label: 'At-Risk', className: 'report-needs-review' };
        const studentDistribution = {
            mastered: scoredStudents.filter((student) => student.accuracy >= 90).length,
            progressing: scoredStudents.filter((student) => student.accuracy >= 70 && student.accuracy < 90).length,
            atRisk: scoredStudents.filter((student) => student.accuracy < 70).length,
            unavailable: playedStudents.length - scoredStudents.length
        };
        const overallNarrative = total
            ? `<p class="summary-report-paragraph summary-report-overview">${playedStudents.length} of ${rosterSize} students attempted this custom question set (${participationRate}% participation); ${unattemptedStudents.length} have no recorded attempt. The section answered ${total} questions across ${playCount} plays, with ${overallAccuracy}% overall accuracy and a ${classAverageAccuracy}% average student accuracy.</p>`
            : `<p class="summary-report-paragraph summary-report-overview">${playedStudents.length} of ${rosterSize} students have an attempt recorded (${participationRate}% participation); ${unattemptedStudents.length} have no recorded attempt. Score data is unavailable for calculating class accuracy.</p>`;
        const distributionCards = [
            ['MASTERED · 90%+', studentDistribution.mastered, 'report-mastered'],
            ['PROGRESSING · 70–89%', studentDistribution.progressing, 'report-progressing'],
            ['AT-RISK · BELOW 70%', studentDistribution.atRisk, 'report-needs-review'],
            ['SCORES UNAVAILABLE', studentDistribution.unavailable, 'report-progressing']
        ].map(([label, count, className]) => `<div class="report-tier-card"><span>${label}</span><strong class="${className}">${count}</strong></div>`).join('');
        const competencyParagraphs = report.competencies.map((item) => {
            const tier = item.total ? tierFor(item.accuracy) : { label: 'Needs Review', className: 'report-progressing' };
            const gaps = item.items.filter((question) => question.accuracy < 70).slice(0, 3);
            const gapContent = gaps.length
                ? `<div class="report-item-gaps"><strong>Learning gaps to review</strong><ul>${gaps.map((question) => `<li><span>${escapeHTML(question.name)}</span><small>${question.correct}/${question.total} correct · ${question.accuracy}%</small></li>`).join('')}</ul></div>`
                : item.items.length
                    ? '<p class="report-no-gaps">No question item is below 70% accuracy.</p>'
                    : '<p class="report-no-gaps">Item-level responses are unavailable for this competency.</p>';
            return `<article class="report-competency-card"><div class="report-competency-heading"><h4>${escapeHTML(item.name)}</h4><span class="report-tier-tag ${tier.className}">${tier.label}</span></div><p>${item.correct} of ${item.total} correct · ${item.accuracy}% section accuracy</p>${gapContent}</article>`;
        }).join('');
        const studentCard = (student, status, detail) => `<article class="report-student-card"><div class="report-student-heading"><strong>${escapeHTML(student.name)}</strong><span class="report-tier-tag ${status.className}">${status.label}</span></div><p>LRN ${escapeHTML(student.lrn)} · ${student.plays} ${student.plays === 1 ? 'play' : 'plays'} · ${student.total ? `${student.score}/${student.total} correct (${student.accuracy}%)` : 'No score data'}</p>${detail ? `<p class="report-student-detail">${detail}</p>` : ''}</article>`;
        const remediationStudents = scoredStudents.filter((student) => student.competencies.some((item) => item.total > 0 && item.accuracy < 70));
        const onTrackStudents = scoredStudents.filter((student) => !student.competencies.some((item) => item.total > 0 && item.accuracy < 70));
        const scoreUnavailableStudents = playedStudents.filter((student) => student.total === 0);
        const remediationGroup = remediationStudents.length
            ? remediationStudents.map((student) => studentCard(student, { label: 'Needs Remediation', className: 'report-needs-review' }, `Review: ${student.competencies.filter((item) => item.total > 0 && item.accuracy < 70).map((item) => `${escapeHTML(item.name)} (${item.accuracy}%)`).join(', ')}.`)).join('')
            : '<p class="report-no-gaps">No students currently meet the below-70% remediation flag.</p>';
        const onTrackGroup = onTrackStudents.length
            ? onTrackStudents.map((student) => studentCard(student, { label: 'On Track', className: 'report-mastered' }, 'Recognize this progress and encourage continued practice.')).join('')
            : '<p class="report-no-gaps">No students are in this group yet.</p>';
        const unattemptedGroup = unattemptedStudents.length
            ? unattemptedStudents.map((student) => studentCard(student, { label: 'Unattempted', className: 'report-unattempted' }, 'Check in and provide an opportunity to complete the question set.')).join('')
            : '<p class="report-no-gaps">All students in the section have an attempt recorded.</p>';
        const unavailableGroup = scoreUnavailableStudents.length
            ? `<div class="report-student-group"><h4>Score unavailable</h4>${scoreUnavailableStudents.map((student) => studentCard(student, { label: 'Needs Review', className: 'report-progressing' }, 'An attempt is recorded, but there is not enough score data to classify performance.')).join('')}</div>`
            : '';
        const emptyMessage = '<p class="report-empty-state">No custom question set attempts are recorded for this section and game.</p>';
        document.getElementById('minigame-summary-report-content').innerHTML = `<div class="student-history-stats"><div class="history-stat-card"><span class="history-stat-label">STUDENTS IN SECTION</span><span class="history-stat-value">${rosterSize}</span></div><div class="history-stat-card"><span class="history-stat-label">PARTICIPATED</span><span class="history-stat-value">${playedStudents.length}</span></div><div class="history-stat-card"><span class="history-stat-label">PARTICIPATION RATE</span><span class="history-stat-value">${participationRate}%</span></div><div class="history-stat-card"><span class="history-stat-label">AVERAGE STUDENT ACCURACY</span><span class="history-stat-value">${classAverageAccuracyLabel}</span></div><div class="history-stat-card"><span class="history-stat-label">OVERALL ACCURACY</span><span class="history-stat-value">${overallAccuracyLabel}</span></div></div>${playedStudents.length ? `<section class="summary-report-section"><h3 class="sub-heading">Overall Summary</h3><p class="summary-report-question">How did the whole section engage and perform?</p>${overallNarrative}<div class="report-tier-grid">${distributionCards}</div></section><section class="summary-report-section"><h3 class="sub-heading">Competency Summary</h3><p class="summary-report-question">Did the class master the learning objective?</p><div class="report-competency-list">${competencyParagraphs || '<p class="report-empty-state">No competency-level question data is available yet.</p>'}</div></section><section class="summary-report-section"><h3 class="sub-heading">Student Summary</h3><p class="summary-report-question">Which students may need intervention or recognition?</p><div class="report-student-group"><h4>Needs Remediation</h4>${remediationGroup}</div><div class="report-student-group"><h4>On Track</h4>${onTrackGroup}</div><div class="report-student-group"><h4>Unattempted</h4>${unattemptedGroup}</div>${unavailableGroup}</section>` : `<section class="summary-report-section"><h3 class="sub-heading">Overall Summary</h3><p class="summary-report-question">How did the whole section engage and perform?</p><p class="summary-report-paragraph summary-report-overview">No attempts are recorded yet. ${unattemptedStudents.length} of ${rosterSize} students have not attempted this set (${participationRate}% participation).</p></section><section class="summary-report-section"><h3 class="sub-heading">Competency Summary</h3><p class="summary-report-question">Did the class master the learning objective?</p><p class="report-empty-state">Competency mastery and item-level diagnosis will appear after students submit responses.</p></section><section class="summary-report-section"><h3 class="sub-heading">Student Summary</h3><p class="summary-report-question">Which students may need intervention or recognition?</p><div class="report-student-group"><h4>Unattempted</h4>${unattemptedGroup}</div></section>`}`;
        summaryReportPanel.hidden = false;
        summaryReportPanel.setAttribute('aria-hidden', 'false');
        document.body.classList.add('student-history-open');
    }

    function downloadMinigameSummaryCSV() {
        const data = activeMinigameSummaryData;
        if (!data) return;
        const report = buildMinigameSummaryReport(data);
        const rows = [['Record Type', 'Student', 'LRN', 'Participation Status', 'Plays', 'Correct', 'Questions', 'Accuracy', 'Competency', 'Mastery Tier', 'Question Item', 'Item Correct', 'Item Attempts', 'Item Accuracy', 'Recommendation']];
        const tierFor = (accuracy, total) => !total ? 'Needs Review' : accuracy >= 90 ? 'Mastered' : accuracy >= 70 ? 'Progressing' : 'At-Risk';
        const participants = report.students.filter((student) => student.plays > 0);
        const totalCorrect = participants.reduce((sum, student) => sum + student.score, 0);
        const totalQuestions = participants.reduce((sum, student) => sum + student.total, 0);
        const participationRate = report.students.length ? Math.round(participants.length / report.students.length * 100) : 0;
        rows.push(['Overall summary', '', '', `${participants.length}/${report.students.length} participated (${participationRate}%)`, participants.reduce((sum, student) => sum + student.plays, 0), totalCorrect, totalQuestions, `${totalQuestions ? Math.round(totalCorrect / totalQuestions * 100) : 0}%`, '', '', '', '', '', '', '']);
        report.students.forEach((student) => {
            const needsRemediation = student.competencies.some((item) => item.total > 0 && item.accuracy < 70);
            const status = !student.plays ? 'Unattempted' : student.total === 0 ? 'Needs Review' : needsRemediation ? 'Needs Remediation' : 'On Track';
            rows.push(['Student summary', student.name, student.lrn, status, student.plays, student.score, student.total, `${student.accuracy}%`, '', '', '', '', '', '', !student.plays ? 'Provide an opportunity to complete the set' : needsRemediation ? 'Review competencies below 70%' : student.total === 0 ? 'Score data unavailable' : 'Recognize progress and continue practice']);
            student.competencies.forEach((item) => {
                rows.push(['Student competency', student.name, student.lrn, status, student.plays, student.score, student.total, `${student.accuracy}%`, item.name, tierFor(item.accuracy, item.total), '', item.correct, item.total, item.total ? `${item.accuracy}%` : '', item.total ? item.accuracy < 70 ? 'Needs Remediation' : item.accuracy >= 90 ? 'Mastered' : 'Progressing' : 'Score data unavailable']);
                item.items.forEach((question) => rows.push(['Student item diagnosis', student.name, student.lrn, status, student.plays, student.score, student.total, `${student.accuracy}%`, item.name, tierFor(item.accuracy, item.total), question.name, question.correct, question.total, `${question.accuracy}%`, question.accuracy < 70 ? 'Review item' : 'No item-level flag']));
            });
        });
        report.competencies.forEach((item) => {
            rows.push(['Section competency', '', '', '', '', '', '', '', item.name, tierFor(item.accuracy, item.total), '', item.correct, item.total, item.total ? `${item.accuracy}%` : '', item.total ? item.accuracy < 70 ? 'Needs Remediation' : item.accuracy >= 90 ? 'Mastered' : 'Progressing' : 'Score data unavailable']);
            item.items.forEach((question) => rows.push(['Section item diagnosis', '', '', '', '', '', '', '', item.name, tierFor(item.accuracy, item.total), question.name, question.correct, question.total, `${question.accuracy}%`, question.accuracy < 70 ? 'Review item' : 'No item-level flag']));
        });
        const csv = '\uFEFF' + rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `competency-summary-${String(data.sectionName).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function addQuestionEditor(question = {}, editorId = 'minigame-question-editor') {
        const editor = document.getElementById(editorId);
        if (!editor) return;
        const index = editor.children.length + 1;
        const oldOptions = Array.isArray(question.options) ? question.options : [];
        const oldAnswerIndex = Number.isInteger(Number(question.answer_index)) ? Number(question.answer_index) : 0;
        const correctAnswer = question.correct_answer ?? oldOptions[oldAnswerIndex] ?? '';
        const wrongAnswers = Array.isArray(question.wrong_answers)
            ? question.wrong_answers
            : oldOptions.filter((_, optionIndex) => optionIndex !== oldAnswerIndex);
        const row = document.createElement('fieldset');
        row.className = 'question-editor-card';
        row.innerHTML = `<legend>Question ${index}</legend><label class="pixel-label">Question <span class="required-indicator" aria-hidden="true">*</span><input class="pixel-input question-prompt" required maxlength="500" value="${escapeHTML(question.question || '')}" placeholder="Enter question" /></label><div class="question-options-grid"><label>Correct answer <span class="required-indicator" aria-hidden="true">*</span><input class="pixel-input question-correct-answer" required maxlength="200" value="${escapeHTML(correctAnswer)}" placeholder="Enter the correct answer" /></label>${[0,1,2].map((i) => `<label>Other choice ${i+1} <span class="required-indicator" aria-hidden="true">*</span><input class="pixel-input question-wrong-option" required maxlength="200" value="${escapeHTML(wrongAnswers[i] || '')}" placeholder="Enter another choice" /></label>`).join('')}</div><label class="pixel-label">Answer explanation<textarea class="pixel-input question-explanation" maxlength="1000" rows="3" placeholder="Explain why the correct answer is right">${escapeHTML(question.explanation || '')}</textarea></label><button type="button" class="pixel-btn btn-danger remove-question-btn">Remove</button>`;
        row.querySelector('.remove-question-btn').addEventListener('click', () => {
            if (editor.children.length <= 5) { alert('A question set must contain at least 5 questions.'); return; }
            row.remove();
            [...editor.children].forEach((card, cardIndex) => { card.querySelector('legend').textContent = `Question ${cardIndex + 1}`; });
        });
        editor.append(row);
    }

    async function loadMinigameSets() {
        const sectionId = document.getElementById('minigame-section-select')?.value;
        const gameId = activeMinigameId;
        const list = document.getElementById('minigame-set-list');
        minigameSetMetadata = new Map();
        updateSummaryReportAvailability();
        if (!sectionId || !list) { if (list) list.innerHTML = '<p>Select a section first.</p>'; return; }
        list.innerHTML = '<p>Loading saved question sets...</p>';
        try {
            const snapshot = await getDocs(query(collection(db, 'sections', sectionId, 'minigameSets'), where('gameId', '==', gameId)));
            minigameSetMetadata = new Map(snapshot.docs.map((item) => [item.id, {
                title: item.data().title || 'Question Set',
                description: item.data().description || ''
            }]));
            const setFilter = document.getElementById('minigame-set-filter');
            if (setFilter) setFilter.innerHTML = `<option value="">All Question Sets</option>${snapshot.docs.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.data().title || 'Question Set')}</option>`).join('')}`;
            updateSummaryReportAvailability();
            list.innerHTML = snapshot.empty ? '<p>No custom sets yet.</p>' : snapshot.docs.map((item) => `<div class="minigame-set-card"><div><strong>${escapeHTML(item.data().title || 'Question Set')}</strong>${item.data().description ? `<span class="minigame-set-description">${escapeHTML(item.data().description)}</span>` : ''}<span>${Number(item.data().questions?.length) || 0} questions</span></div><div class="minigame-set-actions"><button type="button" class="pixel-btn btn-secondary" data-set-action="edit" data-set-id="${escapeHTML(item.id)}">Edit</button><button type="button" class="pixel-btn btn-danger" data-set-action="delete" data-set-id="${escapeHTML(item.id)}">Delete</button></div></div>`).join('');
        } catch (error) { updateSummaryReportAvailability(); list.innerHTML = `<p>${escapeHTML(getFirestoreErrorMessage(error, 'Could not load question sets.'))}</p>`; }
    }

    async function handleMinigameSetAction(event) {
        const button = event.target.closest('[data-set-action]');
        if (!button) return;
        const sectionId = document.getElementById('minigame-section-select')?.value;
        if (!sectionId) return;
        const setRef = doc(db, 'sections', sectionId, 'minigameSets', button.dataset.setId);
        if (button.dataset.setAction === 'delete') {
            if (!confirm('Delete this question set? This cannot be undone.')) return;
            try { await deleteDoc(setRef); await loadMinigameSets(); }
            catch (error) { alert(getFirestoreErrorMessage(error, 'Could not delete this question set.')); }
            return;
        }
        try {
            const snapshot = await getDoc(setRef);
            if (!snapshot.exists()) { alert('This question set could not be found.'); await loadMinigameSets(); return; }
            const data = snapshot.data();
            editingMinigameSetId = snapshot.id;
            editingMinigameSetSourceSectionId = sectionId;
            renderMinigameSectionChoices('edit-minigame-target-sections', [sectionId]);
            document.getElementById('edit-minigame-set-title').value = data.title || '';
            const descriptionInput = document.getElementById('edit-minigame-set-description');
            descriptionInput.value = data.description || '';
            descriptionInput.setCustomValidity('');
            resizeDescriptionTextarea(descriptionInput);
            const editor = document.getElementById('edit-minigame-question-editor');
            editor.replaceChildren();
            (data.questions || []).forEach((question) => addQuestionEditor(question, 'edit-minigame-question-editor'));
            document.getElementById('edit-minigame-panel').hidden = false;
            resizeDescriptionTextarea(descriptionInput);
        } catch (error) { alert(getFirestoreErrorMessage(error, 'Could not open this question set.')); }
    }

    async function saveMinigameSet(event) {
        event.preventDefault();
        const gameId = activeMinigameId;
        const isEditing = event.currentTarget.id === 'edit-minigame-set-form';
        const targetSectionIds = getSelectedMinigameTargetSections(isEditing);
        const title = document.getElementById(isEditing ? 'edit-minigame-set-title' : 'minigame-set-title').value.trim();
        const descriptionInput = document.getElementById(isEditing ? 'edit-minigame-set-description' : 'minigame-set-description');
        const description = descriptionInput.value.trim();
        const editorId = isEditing ? 'edit-minigame-question-editor' : 'minigame-question-editor';
        const rows = [...document.querySelectorAll(`#${editorId} .question-editor-card`)];
        if (!description) {
            descriptionInput.setCustomValidity('Enter the competency this question set assesses.');
            descriptionInput.reportValidity();
            descriptionInput.focus();
            return;
        }
        descriptionInput.setCustomValidity('');
        if (!targetSectionIds.length || !rows.length) { alert('Select at least one section and add at least one question.'); return; }
        const questions = rows.map((row, index) => {
            const correctAnswer = row.querySelector('.question-correct-answer').value.trim();
            const wrongAnswers = [...row.querySelectorAll('.question-wrong-option')].map((input) => input.value.trim());
            return { id: `q${index + 1}`, question: row.querySelector('.question-prompt').value.trim(), options: [correctAnswer, ...wrongAnswers], answer_index: 0, explanation: row.querySelector('.question-explanation').value.trim() };
        });
        if (questions.length < 5 || questions.length > 50) { alert('Add between 5 and 50 questions so a complete minigame round can draw from the set.'); return; }
        const invalid = questions.some((item) => !item.question || item.options.length !== 4 || item.options.some((option) => !option));
        if (invalid) { alert('Complete each question and all four answer choices.'); return; }
        const button = event.submitter;
        if (button) button.disabled = true;
        try {
            const setData = { gameId, title, description, questions, updatedAt: serverTimestamp(), active: true };
            if (isEditing && editingMinigameSetId) {
                if (targetSectionIds.includes(editingMinigameSetSourceSectionId)) {
                    const setRef = doc(db, 'sections', editingMinigameSetSourceSectionId, 'minigameSets', editingMinigameSetId);
                    const currentSet = await getDoc(setRef);
                    const nextVersion = (Number(currentSet.data()?.setVersion) || 1) + 1;
                    await updateDoc(setRef, { ...setData, setVersion: nextVersion });
                }
                for (const targetSectionId of targetSectionIds.filter((id) => id !== editingMinigameSetSourceSectionId)) {
                    const ref = doc(collection(db, 'sections', targetSectionId, 'minigameSets'));
                    await setDoc(ref, { ...setData, setVersion: 1, createdBy: currentUser.uid, createdAt: serverTimestamp() });
                }
                editingMinigameSetId = null;
                editingMinigameSetSourceSectionId = null;
            } else {
                for (const targetSectionId of targetSectionIds) {
                    const ref = doc(collection(db, 'sections', targetSectionId, 'minigameSets'));
                    await setDoc(ref, { ...setData, setVersion: 1, createdBy: currentUser.uid, createdAt: serverTimestamp() });
                }
            }
            if (isEditing) {
                document.getElementById('edit-minigame-set-form').reset();
                resizeDescriptionTextarea(document.getElementById('edit-minigame-set-description'));
                document.getElementById('edit-minigame-question-editor').replaceChildren();
                document.getElementById('edit-minigame-panel').hidden = true;
            } else {
                document.getElementById('minigame-set-form').reset();
                resizeDescriptionTextarea(document.getElementById('minigame-set-description'));
                document.getElementById('minigame-question-editor').replaceChildren();
                addQuestionEditor();
            }
            const activeSectionSelect = document.getElementById('minigame-section-select');
            const displaySectionId = targetSectionIds.includes(activeSectionSelect?.value) ? activeSectionSelect.value : targetSectionIds[0];
            if (activeSectionSelect && activeSectionSelect.value !== displaySectionId) activeSectionSelect.value = displaySectionId;
            if (!isEditing) renderMinigameSectionChoices('create-minigame-target-sections', [displaySectionId]);
            await Promise.all([loadMinigameSets(), loadMinigameResults()]);
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

    function renderMinigameSectionChoices(containerId, selectedSectionIds = []) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const selected = new Set(selectedSectionIds.filter(Boolean));
        container.innerHTML = assignedSections.length
            ? assignedSections.map((section) => `<label class="section-checkbox-option"><input type="checkbox" value="${escapeHTML(section.id)}"${selected.has(section.id) ? ' checked' : ''}><span>${escapeHTML(section.name)}</span></label>`).join('')
            : '<p>No sections assigned.</p>';
    }

    function getSelectedMinigameTargetSections(isEditing) {
        const containerId = isEditing ? 'edit-minigame-target-sections' : 'create-minigame-target-sections';
        return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)].map((checkbox) => checkbox.value);
    }

    function resizeDescriptionTextarea(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
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
