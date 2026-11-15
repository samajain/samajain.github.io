(function () {
  var canvas = document.createElement('canvas');
  canvas.id = 'ds-cursor-canvas';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '-1';
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  var width, height;
  var particles = [];
  var mouse = { x: -1000, y: -1000 };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var particleCount = 60;
  var connectDist = 150;
  var cursorDist = 200;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function Particle() {
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.radius = 1.5 + Math.random() * 2;
  }

  Particle.prototype.update = function () {
    if (reduced) return;
    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0 || this.x > width) this.vx *= -1;
    if (this.y < 0 || this.y > height) this.vy *= -1;

    var dx = mouse.x - this.x;
    var dy = mouse.y - this.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < cursorDist && dist > 0) {
      var force = (cursorDist - dist) / cursorDist;
      this.x -= (dx / dist) * force * 0.8;
      this.y -= (dy / dist) * force * 0.8;
    }
  };

  Particle.prototype.draw = function () {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  function init() {
    resize();
    particles = [];
    for (var i = 0; i < particleCount; i++) particles.push(new Particle());
  }

  function drawLine(a, b, alpha) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + alpha + ')';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    for (var i = 0; i < particles.length; i++) {
      particles[i].update();
      particles[i].draw();

      for (var j = i + 1; j < particles.length; j++) {
        var dx = particles[i].x - particles[j].x;
        var dy = particles[i].y - particles[j].y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < connectDist) {
          drawLine(particles[i], particles[j], 1 - dist / connectDist);
        }
      }

      var dx = mouse.x - particles[i].x;
      var dy = mouse.y - particles[i].y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < cursorDist) {
        drawLine(particles[i], { x: mouse.x, y: mouse.y }, 0.35 * (1 - dist / cursorDist));
      }
    }

    if (!reduced) requestAnimationFrame(animate);
  }

  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('resize', resize);

  init();
  animate();
})();
