let pusher;
let isRunning = false;
let autoAdvanceTimer;
let currentSlideIndex = 0;

Office.onReady((info) => {
  if (info.host === Office.HostType.PowerPoint) {
    console.log('PowerPoint add-in ready');
  }
});

function setStatus(message, type = 'connecting') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = `status ${type}`;
  el.style.display = 'block';
}

function clearStatus() {
  document.getElementById('status').style.display = 'none';
}

async function startPresentation() {
  const pusherKey = document.getElementById('pusherKey').value;
  const pusherCluster = document.getElementById('pusherCluster').value;
  const slideDuration = parseInt(document.getElementById('slideDuration').value) * 1000;

  if (!pusherKey) {
    setStatus('Please enter your Pusher App Key', 'error');
    return;
  }

  setStatus('Connecting to Pusher...', 'connecting');

  try {
    // Initialize Pusher
    pusher = new Pusher(pusherKey, {
      cluster: pusherCluster
    });

    const channel = pusher.subscribe('awana-channel');

    // Listen for check-ins
    channel.bind('checkin', (payload) => {
      showCheckInOverlay(payload);
    });

    // Start auto-advance
    isRunning = true;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('pusherKey').disabled = true;
    document.getElementById('pusherCluster').disabled = true;
    document.getElementById('slideDuration').disabled = true;

    // Get initial slide count
    await Word.run(async (context) => {
      const slideCount = context.presentation.slides.getCount();
      await context.sync();
      currentSlideIndex = 0;
      startAutoAdvance(slideDuration);
      setStatus(`Presentation running (${slideCount} slides)`, 'connected');
    });
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    console.error(err);
  }
}

function stopPresentation() {
  isRunning = false;
  clearTimeout(autoAdvanceTimer);

  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('pusherKey').disabled = false;
  document.getElementById('pusherCluster').disabled = false;
  document.getElementById('slideDuration').disabled = false;

  if (pusher) {
    pusher.unsubscribe('awana-channel');
    pusher.disconnect();
  }

  clearStatus();
}

function startAutoAdvance(duration) {
  const advance = async () => {
    if (isRunning) {
      await nextSlide();
      autoAdvanceTimer = setTimeout(advance, duration);
    }
  };
  autoAdvanceTimer = setTimeout(advance, duration);
}

async function nextSlide() {
  try {
    await Word.run(async (context) => {
      const slideCount = context.presentation.slides.getCount();
      await context.sync();

      currentSlideIndex = (currentSlideIndex + 1) % slideCount;
      context.presentation.slides.getItemAt(currentSlideIndex).load('index');
      await context.sync();

      // This navigates to the slide
      context.presentation.slideLayouts.getItem(currentSlideIndex);
    });
  } catch (err) {
    console.error('Error advancing slide:', err);
  }
}

async function previousSlide() {
  try {
    await Word.run(async (context) => {
      const slideCount = context.presentation.slides.getCount();
      await context.sync();

      currentSlideIndex = (currentSlideIndex - 1 + slideCount) % slideCount;
      context.presentation.slides.getItemAt(currentSlideIndex).load('index');
      await context.sync();
    });
  } catch (err) {
    console.error('Error going to previous slide:', err);
  }
}

function showCheckInOverlay(payload) {
  const firstName = payload.firstName || 'Guest';
  const club = payload.club || '';
  const isBirthday = payload.isBirthday || false;
  const isFirstTimer = payload.isFirstTimer || false;

  // Create overlay element
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    pointer-events: none;
  `;

  const banner = document.createElement('div');
  const isPink = isBirthday;
  const isOrange = isFirstTimer;

  banner.style.cssText = `
    background: linear-gradient(135deg, ${isPink ? '#FF1744' : isOrange ? '#FFD54F' : '#FFD54F'} 0%, ${isPink ? '#F50057' : isOrange ? '#FF8F00' : '#FFF9C4'} 100%);
    color: ${isPink || isOrange ? '#fff' : '#000'};
    padding: 40px 60px;
    border-radius: 32px;
    text-align: center;
    min-width: 400px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  `;

  const emoji = isBirthday ? '🎂' : isFirstTimer ? '✨' : '👋';
  const label = isBirthday ? 'BIRTHDAY!' : isFirstTimer ? 'FIRST TIMER!' : 'WELCOME!';

  banner.innerHTML = `
    <div style="font-size: 60px; margin-bottom: 16px;">${emoji}</div>
    <div style="font-size: 14px; font-weight: 600; letter-spacing: 0.15em; opacity: 0.9; margin-bottom: 8px; text-transform: uppercase;">${label}</div>
    <div style="font-size: 48px; font-weight: 800; margin-bottom: 12px;">${firstName}</div>
    ${club ? `<div style="font-size: 16px; font-weight: 600; opacity: 0.85;">${club}</div>` : ''}
  `;

  overlay.appendChild(banner);
  document.body.appendChild(overlay);

  // Remove after 6-8 seconds
  setTimeout(() => {
    overlay.remove();
  }, isBirthday || isFirstTimer ? 8000 : 6000);
}
