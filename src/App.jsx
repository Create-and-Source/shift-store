import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Menu, X, ArrowRight, Minus, Plus, ChevronRight } from 'lucide-react';
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

function VidDivider({ src, title, subtitle, fallbackBg = 'linear-gradient(135deg, #1a1a1a, #2a2a2a)' }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="vid-divider">
      <div className="vid-divider-clip">
        <div style={{ position: 'absolute', inset: 0, background: fallbackBg }} />
        {src && (
          <video
            className="vid-divider-video"
            src={src}
            autoPlay
            muted
            loop
            playsInline
            onLoadedData={() => setLoaded(true)}
            style={{ opacity: loaded ? 1 : 0 }}
          />
        )}
      </div>
      <div className="vid-divider-overlay-top" />
      <div className="vid-divider-overlay-bottom" />
      <div className="vid-divider-content">
        <motion.div
          className="vid-divider-box"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          {title && <h2 className="vid-divider-title">{title}</h2>}
          {subtitle && <p className="vid-divider-sub">{subtitle}</p>}
        </motion.div>
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
      <header className={`site-header ${scrolled ? 'scrolled' : ''}`}>
        <div className="header-inner">
          <Link to="/" className="header-logo">shift→</Link>
          <nav className="header-nav">
            <Link to="/shop">Shop</Link>
            <Link to="/collections">Collections</Link>
            <Link to="/about">About</Link>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button className="header-cart" onClick={() => setCartOpen(true)}>
              <ShoppingBag size={20} />
              {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
            </button>
            <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>
              <Menu size={24} />
            </button>
          </div>
        </div>
      </header>

      <div className={`mobile-nav ${mobileOpen ? 'open' : ''}`}>
        <button className="mobile-nav-close" onClick={() => setMobileOpen(false)}>
          <X size={28} />
        </button>
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
                  <div className="cart-item-img" style={{ background: item.product.colors[0]?.hex === '#0A0A0A' ? '#1a1a1a' : '#e5e0d8' }} />
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
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <div className="footer-brand-name">shift→</div>
          <p className="footer-brand-desc">
            Shift your mindset. Shift your focus. Shift your perspective. Life keeps moving.
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
          <a href="#">Size Guide</a>
          <a href="#">Contact</a>
        </div>
        <div className="footer-col">
          <h4>Info</h4>
          <a href="#">Shipping</a>
          <a href="#">Returns</a>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; {new Date().getFullYear()} Shift. All rights reserved.</span>
        <span>Life Keeps Moving →</span>
      </div>
    </footer>
  );
}

/* ═══ PAGES ═══ */

function HomePage() {
  const featured = products.filter(p => p.featured);
  const [heroLoaded, setHeroLoaded] = useState(false);

  return (
    <>
      <section className="hero">
        <div className="hero-bg">
          <div className="hero-fallback-bg" />
          <video
            className="hero-video-bg"
            src="/videos/shift-hero.mp4"
            autoPlay
            muted
            loop
            playsInline
            onLoadedData={() => setHeroLoaded(true)}
            style={{ opacity: heroLoaded ? 1 : 0 }}
          />
        </div>
        <motion.div
          className="hero-content"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3 }}
        >
          <div className="hero-logo">shift→</div>
          <div className="hero-tagline">life keeps moving</div>
          <Link to="/shop" className="hero-cta">
            Shop Now <ArrowRight size={14} />
          </Link>
        </motion.div>
        <div className="hero-scroll">
          <span>Scroll</span>
          <div className="hero-scroll-line" />
        </div>
      </section>

      <div className="marquee">
        <div className="marquee-track">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="marquee-item">
              <span>Your Mindset</span><div className="marquee-dot" />
              <span>Your Focus</span><div className="marquee-dot" />
              <span>Your Perspective</span><div className="marquee-dot" />
              <span>Life Keeps Moving</span><div className="marquee-dot" />
              <span>Keep Pushing</span><div className="marquee-dot" />
              <span>Shift Forward</span><div className="marquee-dot" />
              <span>Your Mindset</span><div className="marquee-dot" />
              <span>Your Focus</span><div className="marquee-dot" />
              <span>Your Perspective</span><div className="marquee-dot" />
              <span>Life Keeps Moving</span><div className="marquee-dot" />
            </div>
          ))}
        </div>
      </div>

      <section className="section section-cream">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="section-label">New Arrivals</div>
            <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', marginBottom: 48 }}>
              <h2 className="section-title" style={{ marginBottom: 0 }}>The Collection</h2>
              <Link to="/shop" style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
                View All <ArrowRight size={14} />
              </Link>
            </div>
          </motion.div>
          <div className="products-grid">
            {featured.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        </div>
      </section>

      <VidDivider
        src="/videos/shift-motion.mp4"
        title="Keep Moving Forward"
        subtitle="Built for those who refuse to stand still"
      />

      <VidDivider
        src="/videos/shift-racing.mp4"
        title="Racing Collection"
        subtitle="Limited Edition — Built for Speed. No Limits."
      />

      <section className="section section-cream">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="section-label">The Brand</div>
            <h2 className="section-title">Why Shift?</h2>
            <p className="section-subtitle">
              More than apparel. A mindset. A movement. A daily reminder to keep pushing forward.
            </p>
          </motion.div>
          <div className="values-grid">
            {[
              { num: '01', title: 'Your Mindset', desc: 'What you think becomes who you are. Shift starts in the mind — choosing growth over comfort, action over hesitation.' },
              { num: '02', title: 'Your Focus', desc: 'Cut the noise. Lock in on what matters. Every piece is designed for people who move with intention, not distraction.' },
              { num: '03', title: 'Your Perspective', desc: 'See the world differently. The arrow only points forward — there is no reverse. Embrace the shift and keep moving.' },
            ].map((v, i) => (
              <motion.div
                key={v.num}
                className="value-item"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
              >
                <div className="value-number">{v.num}</div>
                <div className="value-title">{v.title}</div>
                <div className="value-desc">{v.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="newsletter">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="newsletter-title">Join the Movement</div>
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

function ProductCard({ product, index }) {
  const navigate = useNavigate();
  return (
    <motion.div
      className="product-card"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      onClick={() => navigate(`/product/${product.id}`)}
    >
      <div
        className="product-card-img"
        style={{
          background: product.colors[0]?.hex === '#0A0A0A'
            ? 'linear-gradient(135deg, #1a1a1a, #2a2a2a)'
            : 'linear-gradient(135deg, #EDE8E0, #D4CFCA)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 'clamp(24px, 4vw, 40px)', fontWeight: 900, fontStyle: 'italic',
          color: product.colors[0]?.hex === '#0A0A0A' ? 'rgba(237,232,224,0.15)' : 'rgba(10,10,10,0.1)',
        }}
      >
        shift→
      </div>
      {product.badge && (
        <div style={{
          position: 'absolute', top: 16, left: 16,
          background: product.badge === 'Limited' ? '#8B0000' : 'var(--black)',
          color: 'var(--cream)', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          padding: '6px 12px',
        }}>
          {product.badge}
        </div>
      )}
      <div className="product-card-overlay">
        <div className="product-card-name">{product.name}</div>
        <div className="product-card-price">
          {product.comparePrice && (
            <span style={{ textDecoration: 'line-through', opacity: 0.5, marginRight: 8 }}>${product.comparePrice}</span>
          )}
          ${product.price}
        </div>
      </div>
    </motion.div>
  );
}

function ShopPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const filtered = collections.find(c => c.id === activeFilter)?.filter
    ? products.filter(collections.find(c => c.id === activeFilter).filter)
    : products;

  return (
    <div style={{ paddingTop: 80, background: 'var(--cream)', minHeight: '100vh' }}>
      <section className="section section-cream" style={{ paddingBottom: 40 }}>
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="section-title">Shop All</h1>
          </motion.div>
          <div style={{ display: 'flex', gap: 24, marginTop: 24, flexWrap: 'wrap' }}>
            {collections.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveFilter(c.id)}
                style={{
                  fontSize: 12, fontWeight: activeFilter === c.id ? 700 : 500,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: activeFilter === c.id ? 'var(--black)' : 'var(--gray-400)',
                  borderBottom: activeFilter === c.id ? '2px solid var(--black)' : '2px solid transparent',
                  paddingBottom: 8, transition: 'all 0.2s',
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: '0 40px 120px' }}>
        <div className="container">
          <div className="products-grid">
            {filtered.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProductPage() {
  const { id } = useParams();
  const product = products.find(p => p.id === id);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const { addToCart } = useCart();

  if (!product) return <div style={{ padding: '200px 40px', textAlign: 'center' }}>Product not found</div>;

  const handleAdd = () => {
    if (!selectedSize) return;
    addToCart(product, product.colors[selectedColor].name, selectedSize);
  };

  return (
    <div className="product-page">
      <div className="product-layout">
        <div className="product-gallery">
          {product.colors.map((c, i) => (
            <div
              key={i}
              className="product-gallery-img"
              style={{
                background: c.hex === '#0A0A0A' || c.hex === '#2A2A2A'
                  ? 'linear-gradient(135deg, #1a1a1a, #2a2a2a)'
                  : 'linear-gradient(135deg, #EDE8E0, #D4CFCA)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 48, fontWeight: 900, fontStyle: 'italic',
                color: c.hex === '#0A0A0A' || c.hex === '#2A2A2A' ? 'rgba(237,232,224,0.12)' : 'rgba(10,10,10,0.08)',
              }}
            >
              shift→
            </div>
          ))}
        </div>

        <motion.div
          className="product-info"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="product-breadcrumb">
            <Link to="/shop">Shop</Link> <ChevronRight size={10} style={{ margin: '0 6px' }} /> {product.category}
          </div>

          {product.badge && (
            <div style={{
              display: 'inline-block', background: product.badge === 'Limited' ? '#8B0000' : 'var(--black)',
              color: 'var(--cream)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              padding: '5px 12px', marginBottom: 16,
            }}>
              {product.badge}
            </div>
          )}

          <h1 className="product-name">{product.name}</h1>
          <div className="product-price">
            {product.comparePrice && (
              <span style={{ textDecoration: 'line-through', color: 'var(--gray-400)', marginRight: 12 }}>${product.comparePrice}</span>
            )}
            ${product.price}
          </div>
          <p className="product-desc">{product.description}</p>

          {product.colors.length > 1 && (
            <>
              <div className="option-label">Color — {product.colors[selectedColor].name}</div>
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

          <div className="option-label">Size</div>
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

          <button className="add-to-cart" onClick={handleAdd} disabled={!selectedSize} style={{ opacity: selectedSize ? 1 : 0.5 }}>
            {selectedSize ? 'Add to Cart' : 'Select a Size'} <ArrowRight size={14} />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function CollectionsPage() {
  return (
    <div style={{ paddingTop: 80, background: 'var(--cream)', minHeight: '100vh' }}>
      <section className="section section-cream">
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="section-title">Collections</h1>
            <p className="section-subtitle">Curated drops. Each one tells a story.</p>
          </motion.div>
        </div>
      </section>

      <div className="editorial-grid" style={{ margin: '0 40px' }}>
        <Link to="/shop" className="editorial-block" style={{
          background: 'linear-gradient(135deg, #1a1a1a, #2a2a2a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 500,
        }}>
          <div style={{ textAlign: 'center', color: 'var(--cream)' }}>
            <div style={{ fontSize: 14, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.4, marginBottom: 12 }}>Core</div>
            <div style={{ fontSize: 48, fontWeight: 900, letterSpacing: -1 }}>Essentials</div>
          </div>
        </Link>
        <Link to="/shop" className="editorial-block" style={{
          background: 'linear-gradient(135deg, #EDE8E0, #D4CFCA)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 500,
        }}>
          <div style={{ textAlign: 'center', color: 'var(--black)' }}>
            <div style={{ fontSize: 14, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.4, marginBottom: 12 }}>Limited</div>
            <div style={{ fontSize: 48, fontWeight: 900, letterSpacing: -1 }}>Racing</div>
          </div>
        </Link>
      </div>

      <section className="newsletter" style={{ marginTop: 80 }}>
        <div className="newsletter-title">Get Notified</div>
        <p className="newsletter-sub">Be the first to know when new collections drop.</p>
        <form className="newsletter-form" onSubmit={e => e.preventDefault()}>
          <input type="email" placeholder="Your email" />
          <button type="submit">Notify Me</button>
        </form>
      </section>
    </div>
  );
}

function AboutPage() {
  return (
    <div style={{ paddingTop: 80, background: 'var(--cream)', minHeight: '100vh' }}>
      <section className="section section-cream">
        <div className="container" style={{ maxWidth: 700 }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="section-label">The Story</div>
            <h1 className="section-title">Life Keeps Moving</h1>
            <div style={{ fontSize: 16, lineHeight: 2, color: 'var(--gray-600)' }}>
              <p style={{ marginBottom: 24 }}>
                Shift was born from a simple truth: life doesn't wait. The arrow in our logo only points one direction — forward. There is no reverse, no pause button, no going back.
              </p>
              <p style={{ marginBottom: 24 }}>
                We make clothes for people who move. Not just physically, but mentally. People who are shifting their mindset, sharpening their focus, and changing their perspective on what's possible.
              </p>
              <p style={{ marginBottom: 24 }}>
                Every piece we create carries that energy. Heavyweight, premium, built to last — because the journey doesn't end after one wear. Our designs are rooted in movement: roads, speed, direction, purpose.
              </p>
              <p>
                This isn't just streetwear. It's a daily reminder. Shift your mindset. Shift your focus. Shift your perspective. And keep moving forward.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      <div className="editorial-grid">
        <div className="editorial-text">
          <div className="editorial-quote" style={{ fontSize: 'clamp(40px, 6vw, 72px)' }}>shift→</div>
          <div className="editorial-quote-sub">Your Mindset. Your Focus. Your Perspective.</div>
        </div>
        <div className="editorial-block" style={{
          background: 'linear-gradient(135deg, #1a1a1a, #0a0a0a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 500,
        }}>
          <div style={{ fontSize: 120, fontWeight: 900, fontStyle: 'italic', color: 'rgba(237,232,224,0.04)' }}>→</div>
        </div>
      </div>
    </div>
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
