// 移动端菜单
const navToggle = document.getElementById('navToggle')
const mobileNav = document.getElementById('mobileNav')
if (navToggle && mobileNav) {
  navToggle.addEventListener('click', () => mobileNav.classList.toggle('hidden'))
}

// 首页轮播
const slides = document.querySelectorAll('#carousel .carousel-slide')
const dots = document.querySelectorAll('#carousel .carousel-dot')
if (slides.length > 1) {
  let idx = 0
  let timer = setInterval(next, 5000)
  function show (i) {
    slides.forEach((s, k) => {
      s.classList.toggle('opacity-0', k !== i)
      s.classList.toggle('opacity-100', k === i)
    })
    dots.forEach((d, k) => d.classList.toggle('!bg-white', k === i))
  }
  function next () {
    idx = (idx + 1) % slides.length
    show(idx)
  }
  dots.forEach((d) => d.addEventListener('click', () => {
    idx = Number(d.dataset.index)
    show(idx)
    clearInterval(timer)
    timer = setInterval(next, 5000)
  }))
}
