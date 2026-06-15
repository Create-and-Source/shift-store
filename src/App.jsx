import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Menu, X, ArrowRight, ArrowLeft, Minus, Plus, ChevronRight, ChevronLeft } from 'lucide-react';
import { products, collections } from './data/products';

const CartContext = createContext();

function CartProvider({ children }) {
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  const addToCart = (product, color, size) => {
    const key = `${product.id}-${color}-${size}`;
    setCart(prev => {
      const existing = prev.find(i => i.key === key);
      if (existing) return prev.map(i => i.key === key ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { key, product, color, size, qty: 1 }];
    });
    setCartOpen(true);
  };

  const updateQty = (key, delta) => {
    setCart(prev => prev.map(i => i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.product.price * i.qty, 0);

  return (
    <CartContext.Provider value={{ cart, cartOpen, setCartOpen, addToCart, updateQty, cartCount, cartTotal }}>
      {children}
    </CartContext.Provider>
  );
}

function useCart() { return useContext(CartContext); }

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function GlitchText({ children, tag: Tag = 'span', className = '' }) {
  return (
    <Tag className={`glitch ${className}`} data-text={children}>
      {children}
    </Tag>
  );
}

function Ticker() {
  const items = [
    'Life Keeps Moving', 'Oversized Fit', 'Limited Drops', 'Forward Only',
    'No Reverse', 'Shift Your Perspective',
  ];

  return (
    <div className="ticker">
      <div className="ticker-track">
        {[...Array(3)].map((_, rep) =>
          items.map((item, i) => (
            <span className="ticker-text" key={`${rep}-${i}`}>
              {item}
              <span className="ticker-dot" />
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Marquee({ children }) {
  return (
    <div className="marquee">
      <div className="marquee-track">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="marquee-item">{children}</div>
        ))}
      </div>
    </div>
  );
}

function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { setCartOpen, cartCount } = useCart();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <>
      <header className={`header ${scrolled ? 'scrolled' : ''}`}>
        <div className="header-inner">
          <Link to="/" className="header-logo">
            <img src="/shift-logo.png" alt="Shift" className="header-logo-img" />
          </Link>
          <nav className="header-nav">
            <Link to="/shop">Shop</Link>
            <Link to="/collections">Collections</Link>
            <Link to="/about">About</Link>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button className="header-cart" onClick={() => setCartOpen(true)}>
              <ShoppingBag size={20} />
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </button>
            <button className="mobile-toggle" onClick={() => setMobileOpen(true)}>
              <Menu size={24} />
            </button>
          </div>
        </div>
      </header>

      <div className={`mobile-nav ${mobileOpen ? 'open' : ''}`}>
        <button className="mobile-nav-close" onClick={() => setMobileOpen(false)}>
          <X size={28} />
        </button>
        <Link to="/" onClick={() => setMobileOpen(false)}>Home</Link>
        <Link to="/shop" onClick={() => setMobileOpen(false)}>Shop</Link>
        <Link to="/collections" onClick={() => setMobileOpen(false)}>Collections</Link>
        <Link to="/about" onClick={() => setMobileOpen(false)}>About</Link>
      </div>
    </>
  );
}

function CartDrawer() {
  const { cart, cartOpen, setCartOpen, updateQty, cartTotal } = useCart();

  return (
    <>
      <div className={`cart-overlay ${cartOpen ? 'open' : ''}`} onClick={() => setCartOpen(false)} />
      <div className={`cart-drawer ${cartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <span className="cart-title">Cart ({cart.length})</span>
          <button onClick={() => setCartOpen(false)}><X size={20} /></button>
        </div>

        {cart.length === 0 ? (
          <div className="cart-empty">
            <ShoppingBag size={32} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p>Your cart is empty</p>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {cart.map(item => (
                <div key={item.key} className="cart-item">
                  <img className="cart-item-img" src={item.product.image} alt={item.product.name} />
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.product.name}</div>
                    <div className="cart-item-variant">{item.color} / {item.size}</div>
                    <div className="cart-item-price">${item.product.price}</div>
                    <div className="cart-qty">
                      <button onClick={() => updateQty(item.key, -1)}><Minus size={12} /></button>
                      <span>{item.qty}</span>
                      <button onClick={() => updateQty(item.key, 1)}><Plus size={12} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-footer">
              <div className="cart-total">
                <span>Total</span>
                <span>${cartTotal}</span>
              </div>
              <button className="checkout-btn">Checkout <ArrowRight size={14} /></button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <img src="/shift-logo.png" alt="Shift" className="footer-logo-img" />
          <p className="footer-desc">
            Your Mindset. Your Focus. Your Perspective. Life keeps moving — and so do we.
          </p>
        </div>
        <div className="footer-col">
          <h4>Shop</h4>
          <Link to="/shop">All Products</Link>
          <Link to="/shop">Tees</Link>
          <Link to="/shop">Hoodies</Link>
          <Link to="/shop">Crewnecks</Link>
          <Link to="/shop">Headwear</Link>
        </div>
        <div className="footer-col">
          <h4>Company</h4>
          <Link to="/about">About</Link>
          <Link to="/collections">Collections</Link>
        </div>
        <div className="footer-col">
          <h4>Info</h4>
          <a href="#">Shipping</a>
          <a href="#">Returns</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; {new Date().getFullYear()} Shift. All rights reserved.</span>
        <span style={{ color: 'var(--red)' }}>Life Keeps Moving &rarr;</span>
      </div>
    </footer>
  );
}

function ProductCard({ product, index }) {
  const navigate = useNavigate();
  return (
    <motion.div
      className="product-card"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.06 }}
      onClick={() => navigate(`/product/${product.id}`)}
    >
      <div className="glitch-img-wrap">
        <img
          className="product-card-img"
          src={product.image}
          alt={product.name}
          loading="lazy"
        />
      </div>
      {product.badge && <div className="product-card-badge">{product.badge}</div>}
      <div className="product-card-name">{product.name}</div>
      <div className="product-card-price">
        {product.comparePrice && (
          <span style={{ textDecoration: 'line-through', color: 'var(--gray)', marginRight: 8 }}>${product.comparePrice}</span>
        )}
        ${product.price}
      </div>
    </motion.div>
  );
}

function ProductCarousel({ products: items }) {
  const trackRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const navigate = useNavigate();

  const scroll = (dir) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector('.carousel-slide');
    if (!card) return;
    const w = card.offsetWidth + 16;
    const next = Math.max(0, Math.min(current + dir, items.length - 1));
    track.scrollTo({ left: w * next, behavior: 'smooth' });
    setCurrent(next);
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector('.carousel-slide');
    if (!card) return;
    const w = card.offsetWidth + 16;
    const idx = Math.round(track.scrollLeft / w);
    setCurrent(idx);
  };

  return (
    <div className="carousel">
      <div className="carousel-viewfinder">
        <div className="vf-corner vf-tl" />
        <div className="vf-corner vf-tr" />
        <div className="vf-corner vf-bl" />
        <div className="vf-corner vf-br" />
        <div className="carousel-counter">
          <span className="carousel-counter-current">{String(current + 1).padStart(2, '0')}</span>
          <span className="carousel-counter-sep">/</span>
          <span className="carousel-counter-total">{String(items.length).padStart(2, '0')}</span>
        </div>
      </div>

      <div className="carousel-track" ref={trackRef} onScroll={onScroll}>
        {items.map((p, i) => (
          <div
            key={p.id}
            className={`carousel-slide ${i === current ? 'active' : ''}`}
            onClick={() => navigate(`/product/${p.id}`)}
          >
            <div className="carousel-slide-img glitch-img-wrap">
              <img src={p.image} alt={p.name} />
              {p.badge && <div className="carousel-badge">{p.badge}</div>}
            </div>
            <div className="carousel-slide-info">
              <div className="carousel-slide-name">{p.name}</div>
              <div className="carousel-slide-price">${p.price}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="carousel-nav">
        <button className="carousel-btn" onClick={() => scroll(-1)} disabled={current === 0}>
          <ArrowLeft size={18} />
        </button>
        <div className="carousel-dots">
          {items.map((_, i) => (
            <div key={i} className={`carousel-dot ${i === current ? 'active' : ''}`} />
          ))}
        </div>
        <button className="carousel-btn" onClick={() => scroll(1)} disabled={current === items.length - 1}>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

/* ═══ PAGES ═══ */

function HomePage() {
  const featured = products.filter(p => p.featured);
  const [heroLoaded, setHeroLoaded] = useState(false);

  return (
    <>
      {/* SCANLINES */}
      <div className="scanlines" />

      {/* HERO */}
      <section className="hero">
        <div className="hero-media">
          <img src="/lifestyle/street-crossing.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <video
            src="/videos/shift-hero.mp4"
            autoPlay muted loop playsInline
            onLoadedData={() => setHeroLoaded(true)}
            style={{ position: 'absolute', inset: 0, opacity: heroLoaded ? 1 : 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'opacity 1s' }}
          />
          <div className="hero-gradient" />
          <div className="hero-scanline" />
        </div>
        <motion.div
          className="hero-inner"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3 }}
        >
          <img src="/shift-logo.png" alt="Shift" className="hero-logo-img" />
          <div className="hero-tagline">Life Keeps Moving</div>
          <Link to="/shop" className="hero-cta">
            Shop Now <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* TICKER */}
      <Ticker />

      {/* GLITCH MARQUEE */}
      <Marquee>
        <span className="filled">SHIFT</span> <span>&rarr;</span> <span className="red">FORWARD</span> <span>&rarr;</span> <span>ONLY</span> <span>&rarr;</span>
      </Marquee>

      {/* INTRO */}
      <motion.section
        className="intro"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <div className="intro-label">The Brand</div>
        <h2 className="intro-headline">
          <GlitchText>More than apparel. A mindset.</GlitchText>
        </h2>
        <p className="intro-body">
          Every piece carries the energy of forward motion. Heavyweight, premium, built to last — designed for people who move with intention. The arrow only points one direction.
        </p>
      </motion.section>

      {/* SPREAD — Essentials */}
      <section className="spread">
        <div className="spread-img glitch-img-wrap">
          <img src="/lifestyle/street-crossing.png" alt="Shift on the streets" loading="lazy" />
        </div>
        <motion.div
          className="spread-text"
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <h2 className="spread-title"><GlitchText>Meet the Creator</GlitchText></h2>
          <p className="spread-body">
            The heart of this brand is the belief that life's unexpected turns are opportunities to shift, adapt, and move forward. SHIFT was inspired by my own challenges—from weight loss to facing fears—knowing growth comes from change. We're here to encourage you to pivot with purpose, embrace new paths, and ALWAYS keep moving forward.
          </p>
          <Link to="/about" className="spread-link">
            View the Mission <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* PULLQUOTE */}
      <motion.section
        className="pullquote"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <p className="pullquote-text">
          "The arrow only points one direction — <em>forward</em>."
        </p>
      </motion.section>

      {/* PRODUCTS — Camera Roll Carousel */}
      <section className="products-section">
        <div className="products-header">
          <h2 className="products-title">The Collection</h2>
          <Link to="/shop" className="products-link">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <ProductCarousel products={featured} />
      </section>

      {/* MARQUEE 2 */}
      <Marquee>
        <span className="red">NO REVERSE</span> <span>&rarr;</span> <span className="filled">KEEP MOVING</span> <span>&rarr;</span> <span>SHIFT</span> <span>&rarr;</span>
      </Marquee>

      {/* PHOTO GRID */}
      <div className="photo-grid">
        <div className="photo-grid-item tall glitch-img-wrap">
          <img src="/lifestyle/chinatown.jpg" alt="Shift Chinatown" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/nyc-convertible.png" alt="Shift NYC" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/car-meet.png" alt="Shift car meet" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/coffee-shop.png" alt="Shift coffee" loading="lazy" />
        </div>
        <div className="photo-grid-item tall glitch-img-wrap">
          <img src="/lifestyle/nyc-crosswalk.png" alt="Shift crosswalk" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/pool-party.png" alt="Shift poolside" loading="lazy" />
        </div>
      </div>

      {/* DARK SECTION — Racing */}
      <section className="dark-section">
        <div className="spread spread-reverse" style={{ minHeight: 'auto' }}>
          <motion.div
            className="spread-text"
            style={{ background: 'var(--bg-raised)' }}
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="spread-label">Our Staples</div>
            <h2 className="spread-title"><GlitchText>The "OG" Collection</GlitchText></h2>
            <p className="spread-body">
              Vintage acid wash. Cool Graphics. Built for those who know that life keeps moving — and so should we.
            </p>
            <Link to="/shop" className="spread-link">
              Shop Staples <ArrowRight size={14} />
            </Link>
          </motion.div>
          <div className="spread-img glitch-img-wrap">
            <video src="/videos/shift-racing.mp4" autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
      </section>

      {/* SPREAD — New Colorways */}
      <section className="spread">
        <div className="spread-img glitch-img-wrap">
          <img src="/lifestyle/convertible-pink-red.png" alt="Pink collection" loading="lazy" />
        </div>
        <motion.div
          className="spread-text"
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="spread-label">New Drops</div>
          <h2 className="spread-title"><GlitchText>Fresh Colorways</GlitchText></h2>
          <p className="spread-body">
            Pink Collection and Olive & Orange. New energy, same heavyweight quality. Limited quantities.
          </p>
          <Link to="/shop" className="spread-link">
            Shop New Arrivals <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* NEWSLETTER */}
      <section className="newsletter">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="newsletter-label">Stay Locked In</div>
          <h3 className="newsletter-title"><GlitchText>Join the Movement</GlitchText></h3>
          <p className="newsletter-sub">Early access to drops, exclusive colorways, and first dibs on limited editions.</p>
          <form className="newsletter-form" onSubmit={e => e.preventDefault()}>
            <input type="email" placeholder="Your email" />
            <button type="submit">Subscribe</button>
          </form>
        </motion.div>
      </section>
    </>
  );
}

function ShopPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const filtered = collections.find(c => c.id === activeFilter)?.filter
    ? products.filter(collections.find(c => c.id === activeFilter).filter)
    : products;

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Shop All</GlitchText></h1>
          <div className="shop-filters">
            {collections.map(c => (
              <button
                key={c.id}
                className={`filter-btn ${activeFilter === c.id ? 'active' : ''}`}
                onClick={() => setActiveFilter(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
      <div className="shop-grid">
        {filtered.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} />
        ))}
      </div>
    </>
  );
}

function ProductPage() {
  const { id } = useParams();
  const product = products.find(p => p.id === id);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const { addToCart } = useCart();

  if (!product) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--gray)' }}>Product not found</div>;

  const handleAdd = () => {
    if (!selectedSize) return;
    addToCart(product, product.colors[selectedColor].name, selectedSize);
  };

  return (
    <div className="pdp">
      <div className="scanlines" />
      <div className="pdp-layout">
        <div className="glitch-img-wrap">
          <img className="pdp-gallery-img" src={product.image} alt={product.name} />
        </div>

        <motion.div
          className="pdp-info"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="pdp-breadcrumb">
            <Link to="/shop">Shop</Link> <ChevronRight size={10} style={{ margin: '0 6px' }} /> {product.category}
          </div>

          {product.badge && <div className="product-card-badge" style={{ marginBottom: 16 }}>{product.badge}</div>}

          <h1 className="pdp-name">{product.name}</h1>
          <div className="pdp-price">
            {product.comparePrice && (
              <span style={{ textDecoration: 'line-through', color: 'var(--gray)', marginRight: 12 }}>${product.comparePrice}</span>
            )}
            ${product.price}
          </div>
          <p className="pdp-desc">{product.description}</p>

          {product.colors.length > 1 && (
            <>
              <div className="pdp-label">Color — {product.colors[selectedColor].name}</div>
              <div className="color-options">
                {product.colors.map((c, i) => (
                  <button
                    key={c.name}
                    className={`color-swatch ${selectedColor === i ? 'active' : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => setSelectedColor(i)}
                  />
                ))}
              </div>
            </>
          )}

          <div className="pdp-label">Size</div>
          <div className="size-options">
            {product.sizes.map(s => (
              <button
                key={s}
                className={`size-btn ${selectedSize === s ? 'active' : ''}`}
                onClick={() => setSelectedSize(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <button className="add-btn" onClick={handleAdd} style={{ opacity: selectedSize ? 1 : 0.5 }}>
            {selectedSize ? 'Add to Cart' : 'Select a Size'} <ArrowRight size={14} />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function CollectionsPage() {
  const boards = [
    { img: '/lifestyle/pizza-shop.png', label: 'Core', title: 'Essentials', rot: -3 },
    { img: '/lifestyle/car-meet.png', label: 'Limited', title: 'Racing', rot: 2.5 },
    { img: '/lifestyle/convertible-pink-red.png', label: 'New', title: 'Fresh Drops', rot: -1.5 },
    { img: '/lifestyle/subway.png', label: 'Vintage', title: 'City Series', rot: 4 },
    { img: '/lifestyle/chinatown.jpg', label: 'Street', title: 'Chinatown', rot: -2 },
    { img: '/lifestyle/nyc-crosswalk.png', label: 'Lifestyle', title: 'NYC', rot: 3 },
  ];

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Collections</GlitchText></h1>
          <p style={{ fontSize: 15, color: 'var(--gray)', marginTop: 12 }}>Curated drops. Each one tells a story.</p>
        </motion.div>
      </div>

      <div className="board">
        <div className="board-inner">
          {boards.map((b, i) => (
            <Link
              to="/shop"
              key={i}
              className="pin-card"
              style={{
                '--rot': `${b.rot}deg`,
                '--delay': `${i * 0.4}s`,
              }}
            >
              <div className="pin" />
              <div className="pin-shadow" />
              <div className="pin-photo">
                <img src={b.img} alt={b.title} loading="lazy" />
              </div>
              <div className="pin-label">
                <span className="pin-label-tag">{b.label}</span>
                <span className="pin-label-title">{b.title}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <section className="newsletter" style={{ marginTop: 40 }}>
        <div className="newsletter-label">Be First</div>
        <h3 className="newsletter-title"><GlitchText>Get Notified</GlitchText></h3>
        <p className="newsletter-sub">Be the first to know when new collections drop.</p>
        <form className="newsletter-form" onSubmit={e => e.preventDefault()}>
          <input type="email" placeholder="Your email" />
          <button type="submit">Notify Me</button>
        </form>
      </section>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <div className="scanlines" />
      <div className="shop-header" style={{ paddingBottom: 0 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: 16 }}>The Story</div>
          <h1 className="shop-title"><GlitchText>Life Keeps Moving</GlitchText></h1>
        </motion.div>
      </div>

      <motion.section
        className="intro"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        style={{ paddingTop: 60 }}
      >
        <p className="intro-body">
          Shift was born from a simple truth: life doesn't wait. The arrow in our logo only points one direction — forward. There is no reverse, no pause button, no going back.
        </p>
        <p className="intro-body" style={{ marginTop: 24 }}>
          We make clothes for people who move. Not just physically, but mentally. People who are shifting their mindset, sharpening their focus, and changing their perspective on what's possible.
        </p>
        <p className="intro-body" style={{ marginTop: 24 }}>
          Every piece we create carries that energy. Heavyweight, premium, built to last — because the journey doesn't end after one wear. Our designs are rooted in movement: roads, speed, direction, purpose.
        </p>
      </motion.section>

      <div className="pullquote">
        <p className="pullquote-text">
          "This isn't just streetwear. It's a daily reminder. Shift your mindset. Shift your focus. Shift your perspective. <em>And keep moving forward.</em>"
        </p>
      </div>

      <section className="spread">
        <div className="spread-img glitch-img-wrap">
          <img src="/lifestyle/convertible-pink-red.png" alt="Shift lifestyle" loading="lazy" />
        </div>
        <div className="spread-text" style={{ alignItems: 'center', textAlign: 'center' }}>
          <img src="/shift-logo.png" alt="Shift" style={{ width: 200, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
          <p style={{ fontSize: 15, color: 'var(--gray)', lineHeight: 1.8 }}>Your Mindset. Your Focus. Your Perspective.</p>
        </div>
      </section>

      <div className="photo-grid">
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/nyc-crosswalk.png" alt="NYC" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/pool-party.png" alt="Pool party" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/street-crossing.png" alt="Street" loading="lazy" />
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <ScrollToTop />
        <Header />
        <CartDrawer />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/product/:id" element={<ProductPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
        <Footer />
      </CartProvider>
    </BrowserRouter>
  );
}
