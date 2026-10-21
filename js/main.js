document.addEventListener('DOMContentLoaded', () => {
    const snapContainer = document.getElementById('snapContainer');
    const sections = document.querySelectorAll('.snap-section');
    const backToTopBtn = document.getElementById('backToTopBtn');
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const navMenu = document.getElementById('navMenu');
    const navOverlay = document.getElementById('navOverlay');
    const lightboxModal = document.getElementById('lightboxModal');

    // hamburgir menu toggle
    const closeMobileMenu = () => {
        navMenu.classList.remove('open');
        hamburgerBtn.classList.remove('open');
        navOverlay.classList.remove('open');
        hamburgerBtn.setAttribute('aria-expanded', 'false');
    };

    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = navMenu.classList.toggle('open');
        hamburgerBtn.classList.toggle('open', isOpen);
        navOverlay.classList.toggle('open', isOpen);
        hamburgerBtn.setAttribute('aria-expanded', isOpen);
    });

    navOverlay.addEventListener('click', closeMobileMenu);

    document.addEventListener('click', (e) => {
        if (navMenu.classList.contains('open') && !navMenu.contains(e.target) && e.target !== hamburgerBtn) {
            closeMobileMenu();
        }
    });

    // genshin ref scrolling styly
    let currentPage = 0;
    let isScrolling = false;
    const scrollCooldown = 550;

    function goToPage(index) {
        if (index < 0 || index >= sections.length || isScrolling) return;

        isScrolling = true;
        currentPage = index;

        snapContainer.style.transform = `translateY(-${currentPage * 100}vh)`;
        backToTopBtn.classList.toggle('visible', currentPage > 0);

        setTimeout(() => {
            isScrolling = false;
        }, scrollCooldown);
    }

    window.addEventListener('wheel', (e) => {
        if (lightboxModal.classList.contains('active') || navMenu.classList.contains('open')) return;
        if (isScrolling) return;

        if (e.deltaY > 15) {
            goToPage(currentPage + 1);
        } else if (e.deltaY < -15) {
            goToPage(currentPage - 1);
        }
    }, { passive: true });

    let touchStartY = 0;
    window.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
        if (lightboxModal.classList.contains('active') || navMenu.classList.contains('open') || isScrolling) return;
        const touchEndY = e.changedTouches[0].clientY;
        const diff = touchStartY - touchEndY;

        if (Math.abs(diff) > 50) {
            if (diff > 0) {
                goToPage(currentPage + 1);
            } else {
                goToPage(currentPage - 1);
            }
        }
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
        if (lightboxModal.classList.contains('active')) return;
        if (e.key === 'ArrowDown' || e.key === 'PageDown') {
            goToPage(currentPage + 1);
        } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
            goToPage(currentPage - 1);
        }
    });

    backToTopBtn.addEventListener('click', () => {
        goToPage(0);
    });

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            closeMobileMenu();

            if (targetId === '#about-section') {
                e.preventDefault();
                goToPage(1);
            } else if (targetId === '#section-1') {
                e.preventDefault();
                goToPage(0);
            }
        });
    });

    // carousel slide auto
    const slidesContainer = document.getElementById('slidesContainer');
    const thumbsContainer = document.getElementById('carouselThumbnails');
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.dot');
    const thumbs = document.querySelectorAll('.thumb');

    let currentSlide = 0;
    const totalSlides = slides.length;
    const autoSlideIntervalTime = 2500;
    let autoSlideTimer = null;

    function updateCarousel(index) {
        currentSlide = (index + totalSlides) % totalSlides;

        slidesContainer.style.transform = `translateX(-${currentSlide * 100}%)`;

        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === currentSlide);
        });

        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === currentSlide);
        });

        thumbs.forEach((thumb, i) => {
            const isActive = i === currentSlide;
            thumb.classList.toggle('active', isActive);
            if (isActive && thumbsContainer && thumbsContainer.scrollWidth > thumbsContainer.clientWidth) {
                const scrollLeft = thumb.offsetLeft - (thumbsContainer.clientWidth / 2) + (thumb.clientWidth / 2);
                thumbsContainer.scrollTo({ left: scrollLeft, behavior: 'smooth' });
            }
        });
    }

    function startAutoSlide() {
        stopAutoSlide();
        autoSlideTimer = setInterval(() => {
            updateCarousel(currentSlide + 1);
        }, autoSlideIntervalTime);
    }

    function stopAutoSlide() {
        if (autoSlideTimer) {
            clearInterval(autoSlideTimer);
            autoSlideTimer = null;
        }
    }

    startAutoSlide();

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            updateCarousel(index);
            startAutoSlide();
        });
    });

    thumbs.forEach((thumb, index) => {
        thumb.addEventListener('click', () => {
            updateCarousel(index);
            startAutoSlide();
        });
    });

    // lghtbox
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxClose = document.getElementById('lightboxClose');
    const slideImages = document.querySelectorAll('.slide img');

    slideImages.forEach(img => {
        img.addEventListener('click', () => {
            stopAutoSlide();
            lightboxImg.src = img.src;
            lightboxImg.alt = img.alt;
            lightboxModal.classList.add('active');
            lightboxModal.setAttribute('aria-hidden', 'false');
        });
    });

    const closeLightbox = () => {
        lightboxModal.classList.remove('active');
        lightboxModal.setAttribute('aria-hidden', 'true');
        startAutoSlide();
    };

    lightboxClose.addEventListener('click', closeLightbox);

    lightboxModal.addEventListener('click', (e) => {
        if (e.target === lightboxModal) {
            closeLightbox();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightboxModal.classList.contains('active')) {
            closeLightbox();
        }
    });
});