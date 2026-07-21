import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Menu, X, ArrowRight, ArrowLeft, Minus, Plus, ChevronRight, ChevronLeft, CheckCircle, Loader, Package, Truck, Eye, LogOut, Lock, Mail, Clock, Search, Download } from 'lucide-react';
import { supabase } from './lib/supabase';

/* ═══ PRODUCTS CONTEXT — merges Fulfill Engine + Printify + Shopify ═══ */
const ProductsContext = createContext();

function ProductsProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customCategories, setCustomCategories] = useState([]);
  const [stock, setStock] = useState({});
  const [loading, setLoading] = useState(true);

  // FE blank-level availability — fetched apart from the product feeds so it
  // never delays first paint; until it lands everything reads as in stock.
  useEffect(() => {
    fetch('/api/stock')
      .then(r => r.json())
      .then(d => setStock(d.stock || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/products').then(r => r.json()).catch(() => ({ products: [] })),
      fetch('/api/admin/categories').then(r => r.json()).catch(() => ({})),
      fetch('/api/printify/products').then(r => r.json()).catch(() => ({ products: [] })),
      fetch('/api/shopify/products').then(r => r.json()).catch(() => ({ products: [] })),
      fetch('/api/admin/content').then(r => r.json()).catch(() => ({ overrides: {} })),
    ]).then(([prodData, catData, pfData, shData, contentData]) => {
      const hidden = new Set(catData.hiddenProductIds || []);
      const overrides = contentData.overrides || {};
      const feProducts = (prodData.products || []).map(p => ({ ...p, source: p.source || 'fulfillengine' }));
      const pfProducts = (pfData.products || []);
      const shProducts = (shData.products || []);
      let allProducts = [...feProducts, ...pfProducts, ...shProducts].filter(p => !hidden.has(p.id));

      // Apply admin overrides — swap in uploaded mockups / name / price.
      allProducts = allProducts.map(p => {
        const ov = overrides[p.id];
        if (!ov) return p;
        const next = { ...p };
        if (Array.isArray(ov.image_urls) && ov.image_urls.length) {
          const imgs = ov.image_urls.map(url => ({ url, zoom: url, thumbnail: url, type: 'custom' }));
          next.image = imgs[0].url; // uploaded mockup leads the card
          // Keep the original photos — show uploaded mockups first, then the originals.
          const origImages = p.colors?.[0]?.images || [];
          next.colors = (p.colors || []).length
            ? [{ ...p.colors[0], images: [...imgs, ...origImages] }, ...p.colors.slice(1)]
            : [{ name: 'Default', hex: '#0A0A0A', images: imgs }];
        }
        if (ov.name) next.name = ov.name;
        if (ov.description) next.description = ov.description;
        if (ov.price != null) { next.price = ov.price; next.basePrice = ov.price; }
        return next;
      });

      // Attach custom categories to each product
      const assignMap = new Map();
      const catById = new Map((catData.categories || []).map(c => [c.id, c.name]));
      for (const a of (catData.assignments || [])) {
        const name = catById.get(a.category_id);
        if (!name) continue;
        const cur = assignMap.get(a.product_id) || [];
        cur.push(name);
        assignMap.set(a.product_id, cur);
      }
      allProducts.forEach(p => { p.customCategories = assignMap.get(p.id) || []; });

      setProducts(allProducts);
      setCategories(prodData.categories || []);
      setCustomCategories(catData.categories || []);
    }).catch(err => console.error('Failed to load products:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ProductsContext.Provider value={{ products, categories, customCategories, stock, loading }}>
      {children}
    </ProductsContext.Provider>
  );
}

function useProducts() { return useContext(ProductsContext); }

/* ═══ AUTH CONTEXT ═══ */
const AuthContext = createContext();

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      // Reset-email links can land on ANY page (Supabase falls back to the
      // Site URL) — flag the recovery and carry it to /account, where the
      // set-new-password card lives.
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('shift-recovery', '1');
        if (window.location.pathname !== '/account') window.location.assign('/account');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() { return useContext(AuthContext); }

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate('/account', { replace: true });
  }, [user, loading, navigate]);
  if (loading) return <div style={{ padding: '200px 0', textAlign: 'center' }}><Loader size={24} className="spin" /></div>;
  return user ? children : null;
}

const CartContext = createContext();

function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shift-cart')) || []; } catch { return []; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    localStorage.setItem('shift-cart', JSON.stringify(cart));
    // Editing the cart is how a sold-out error gets resolved — reset it.
    setCheckoutError('');
  }, [cart]);

  const addToCart = (product, color, size, image, sizeSurcharge = 0) => {
    const key = `${product.id}-${color}-${size}`;
    const price = product.price + sizeSurcharge;
    // For Printify products, resolve the chosen color+size to its variant_id
    // so the webhook can submit the order to Printify for production.
    const printifyVariantId = product.variantMap?.[`${color}|${size}`] ?? null;
    setCart(prev => {
      const existing = prev.find(i => i.key === key);
      if (existing) return prev.map(i => i.key === key ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { key, product, color, size, image, price, qty: 1, printifyVariantId }];
    });
    setCartOpen(true);
  };

  const updateQty = (key, delta) => {
    setCart(prev => prev.map(i => i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };

  const clearCart = () => { setCart([]); localStorage.removeItem('shift-cart'); };

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  const checkout = async () => {
    if (cart.length === 0 || checkingOut) return;
    setCheckingOut(true);
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(i => ({
            productId: i.product.id,
            name: i.product.name,
            price: i.price,
            qty: i.qty,
            color: i.color,
            size: i.size,
            image: i.image,
            source: i.product.source || 'static',
            printifyProductId: i.product.printifyProductId || '',
            printifyVariantId: i.printifyVariantId || 0,
          })),
          shipping: 10,
          customerEmail: user?.email || '',
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('Checkout error:', data.error);
        setCheckoutError(
          data.error === 'sold_out'
            ? (data.message || 'Something in your cart just sold out — remove it to continue.')
            : (data.error || 'Checkout failed — please try again.')
        );
        setCheckingOut(false);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setCheckoutError('Checkout failed — please try again.');
      setCheckingOut(false);
    }
  };

  return (
    <CartContext.Provider value={{ cart, cartOpen, setCartOpen, addToCart, updateQty, clearCart, cartCount, cartTotal, checkout, checkingOut, checkoutError }}>
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
            <Link to="/account">Account</Link>
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
        <Link to="/account" onClick={() => setMobileOpen(false)}>Account</Link>
      </div>
    </>
  );
}

function CartDrawer() {
  const { cart, cartOpen, setCartOpen, updateQty, cartTotal } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

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
                  <img className="cart-item-img" src={item.image || item.product.image} alt={item.product.name} />
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.product.name}</div>
                    <div className="cart-item-variant">{item.color} / {item.size}</div>
                    <div className="cart-item-price">${item.price.toFixed(2)}</div>
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
                <span>Subtotal</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>Shipping calculated at checkout</div>
              {user ? (
                <button className="checkout-btn" onClick={() => { setCartOpen(false); navigate('/checkout'); }}>
                  Checkout <ArrowRight size={14} />
                </button>
              ) : (
                <button className="checkout-btn" onClick={() => { setCartOpen(false); navigate('/account'); }}>
                  Sign In to Checkout <ArrowRight size={14} />
                </button>
              )}
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
        <div className="footer-brand">
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
          <Link to="/info/shipping">Shipping</Link>
          <Link to="/info/returns">Returns</Link>
          <Link to="/info/privacy">Privacy</Link>
          <Link to="/info/terms">Terms</Link>
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
  const { stock } = useProducts();
  const out = productSoldOut(stock, product);
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
      {(out || product.badge) && <div className={`product-card-badge${out ? ' soldout' : ''}`}>{out ? 'Sold Out' : product.badge}</div>}
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

// Serve a downscaled image for dense thumbnail grids/marquees. Supabase Storage
// public objects go through the on-the-fly render/transform endpoint (~5-8× less
// decoded GPU memory), which stops iOS Safari from evicting a heavy composited
// row's layer and blanking it. Non-Supabase URLs pass through unchanged.
function thumb(url, width) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('/storage/v1/object/public/')) {
    const t = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    // resize=contain + a tall height cap keeps the real aspect ratio (width-only
    // squishes to the original height); returns e.g. 500x632, not a distorted 500x1400.
    return t + (t.includes('?') ? '&' : '?') + `width=${width}&height=${width * 3}&resize=contain&quality=70`;
  }
  return url;
}

function MarqueeRow({ items, reverse, speed }) {
  const trackRef = useRef(null);
  const navigate = useNavigate();
  const { stock } = useProducts();
  const st = useRef({ pos: 0, hover: false, dragging: false, moved: false, lastX: 0 });
  const loop = [...items, ...items];

  // GPU-composited transform marquee off a float position — no native scroll,
  // so it can't fight iOS momentum or lose sub-pixel steps to scrollLeft rounding.
  // Users still grab/swipe each row via pointer events (auto-scroll pauses meanwhile).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const s = st.current;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dir = reverse ? -1 : 1;

    let raf;
    const tick = () => {
      // Measure one copy of the (2×-duplicated) list live each frame. Reading
      // scrollWidth after a transform-only write is cheap (transforms don't dirty
      // layout) and keeps `half` correct as images load / the mobile breakpoint
      // applies — no stale-measurement race that could strand a row off-screen.
      const half = track.scrollWidth / 2;
      if (half > 0) {
        if (!s.hover && !s.dragging && !reduce) s.pos += dir * speed;
        // Modulo wrap → pos is ALWAYS snapped into [0, half); an overshoot can't
        // survive even one frame, so a row can never park itself blank.
        s.pos = ((s.pos % half) + half) % half;
        track.style.transform = `translate3d(${-s.pos}px,0,0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [items.length, reverse, speed]);

  const s = st.current;
  const onPointerDown = (e) => {
    s.dragging = true; s.moved = false; s.lastX = e.clientX;
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    if (Math.abs(dx) > 3) s.moved = true;
    s.pos -= dx;              // drag right → content follows the finger
    s.lastX = e.clientX;
  };
  const endDrag = () => { s.dragging = false; };

  return (
    <div
      className="pmar-row"
      onMouseEnter={() => { s.hover = true; }}
      onMouseLeave={() => { s.hover = false; s.dragging = false; }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="pmar-track" ref={trackRef}>
        {loop.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            className="pmar-card"
            onClick={() => { if (!s.moved) navigate(`/product/${p.id}`); }}
          >
            <div className="carousel-slide-img glitch-img-wrap">
              <img src={thumb(p.image, 500)} alt={p.name} draggable="false" decoding="async" />
              {(productSoldOut(stock, p) || p.badge) && (
                <div className={`carousel-badge${productSoldOut(stock, p) ? ' soldout' : ''}`}>
                  {productSoldOut(stock, p) ? 'Sold Out' : p.badge}
                </div>
              )}
            </div>
            <div className="carousel-slide-info">
              <div className="carousel-slide-name">{p.name}</div>
              <div className="carousel-slide-price">${p.price}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductCarousel({ products: items }) {
  const mid = Math.ceil(items.length / 2);
  const rowA = items.slice(0, mid);
  const rowB = items.slice(mid);
  return (
    <div className="pmar">
      {rowA.length > 0 && <MarqueeRow items={rowA} reverse={false} speed={0.4} />}
      {rowB.length > 0 && <MarqueeRow items={rowB} reverse={true} speed={0.4} />}
    </div>
  );
}

/* ═══ PAGES ═══ */

function HomePage() {
  const { products, customCategories } = useProducts();
  const featured = products.slice(0, 16);
  const categoryTiles = (customCategories || []).filter(c => c.image_url);
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
          <GlitchText tag="div" className="hero-tagline hero-tagline-cc">Life Keeps Moving</GlitchText>
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
          <img src="/lifestyle/creator.jpg" alt="Meet the creator — SHIFT" loading="lazy" style={{ objectPosition: 'center 30%' }} />
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
            The heart of this brand is the belief that life's unexpected turns are opportunities to shift, adapt, and move forward. SHIFT was inspired by my own challenges and pivot points in life — knowing growth comes from change. We're here to encourage you to move with purpose, embrace new paths, and ALWAYS keep moving forward. Life keeps moving, so should you.
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

      {/* SHOP BY CATEGORY */}
      {categoryTiles.length > 0 && (
        <section className="category-section">
          <div className="products-header">
            <h2 className="products-title">Shop by Category</h2>
            <Link to="/shop" className="products-link">View All <ArrowRight size={14} /></Link>
          </div>
          <div className="category-grid">
            {categoryTiles.map(cat => (
              <Link
                key={cat.id}
                to={`/shop?category=${encodeURIComponent(cat.name)}`}
                className="category-tile glitch-img-wrap"
              >
                <img src={cat.image_url} alt={cat.name} loading="lazy" />
                <div className="category-tile-overlay">
                  <span className="category-tile-name">{cat.name}</span>
                  <span className="category-tile-cta">Shop <ArrowRight size={12} /></span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* MARQUEE 2 */}
      <Marquee>
        <span className="red">NO REVERSE</span> <span>&rarr;</span> <span className="filled">KEEP MOVING</span> <span>&rarr;</span> <span>SHIFT</span> <span>&rarr;</span>
      </Marquee>

      {/* PHOTO GRID */}
      <div className="photo-grid">
        <div className="photo-grid-item tall glitch-img-wrap">
          <img src="/lifestyle/shift-walk.jpg" alt="Shift — life keeps moving" loading="lazy" />
        </div>
        <div className="photo-grid-item pg-wide glitch-img-wrap">
          <img src="/lifestyle/shift-convertible.jpg" alt="Shift NYC convertible" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/shift-caps.jpg" alt="Shift caps in SoHo" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/shift-alley.jpg" alt="Shift hoodies" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/shift-skate.jpg" alt="Shift skate" loading="lazy" />
        </div>
      </div>

      {/* DARK SECTION — OG Collection (centered) */}
      <section className="dark-section">
        <motion.div
          className="spread-text spread-centered"
          style={{ background: 'var(--bg-raised)' }}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
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
      </section>


      {/* NEWSLETTER — emails land in the admin Subscribers page */}
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
          <NewsletterForm />
        </motion.div>
      </section>
    </>
  );
}

function ShopPage() {
  const { products, categories, customCategories, loading } = useProducts();
  const [searchParams] = useSearchParams();
  const [activeFilter, setActiveFilter] = useState('all');

  // Preselect a category when arriving from a homepage tile (?category=Name).
  useEffect(() => {
    const cat = searchParams.get('category');
    if (cat) setActiveFilter(cat);
  }, [searchParams]);

  // Use custom categories if available, fall back to FE categories
  const hasCustom = customCategories.length > 0;
  const filters = hasCustom
    ? [{ id: 'all', name: 'All' }, ...customCategories.map(c => ({ id: c.name, name: c.name, image_url: c.image_url }))]
    : [{ id: 'all', name: 'All' }, ...categories.map(c => ({ id: c.id || c.name, name: c.name }))];
  const usePhotoTiles = hasCustom && customCategories.some(c => c.image_url);

  // Spread the "All" grid so same-category items aren't clustered together
  // (e.g. not 3 hats in a row). Deterministic round-robin: deal one product
  // from each category in rotation, preserving each category's internal order.
  const spreadProducts = (list) => {
    const groups = new Map();
    for (const p of list) {
      const key = (p.customCategories && p.customCategories[0]) || p.category || p.source || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const buckets = [...groups.values()];
    const out = [];
    for (let round = 0; out.length < list.length; round++) {
      let progressed = false;
      for (const b of buckets) {
        if (round < b.length) { out.push(b[round]); progressed = true; }
      }
      if (!progressed) break;
    }
    return out;
  };

  const filtered = activeFilter === 'all'
    ? spreadProducts(products)
    : hasCustom
      ? products.filter(p => (p.customCategories || []).includes(activeFilter))
      : products.filter(p => p.category === activeFilter);

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Shop All</GlitchText></h1>
          {filters.length > 1 && (
            usePhotoTiles ? (
              <div className="shop-cat-tiles">
                {filters.map(c => (
                  <button
                    key={c.id}
                    className={`shop-cat-tile ${activeFilter === c.id ? 'active' : ''} ${c.image_url ? 'has-photo' : ''}`}
                    onClick={() => setActiveFilter(c.id)}
                    style={c.image_url ? { backgroundImage: `linear-gradient(rgba(10,10,10,.35), rgba(10,10,10,.65)), url(${c.image_url})` } : {}}
                  >
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="shop-filters">
                {filters.map(c => (
                  <button
                    key={c.id}
                    className={`filter-btn ${activeFilter === c.id ? 'active' : ''}`}
                    onClick={() => setActiveFilter(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )
          )}
        </motion.div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--gray)' }}>
          <Loader size={24} className="spin" />
          <p style={{ marginTop: 16 }}>Loading products...</p>
        </div>
      ) : (
        <div className="shop-grid">
          {filtered.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      )}
    </>
  );
}

// Tidy size labels: short abbreviations + a canonical order, so a feed's
// "X-Small / XX-Large" render as clean, consistently-ordered chips (the raw
// s.name is still what goes to the cart).
const SIZE_ABBR = { 'xx-small': 'XXS', 'x-small': 'XS', 'small': 'S', 'medium': 'M', 'large': 'L', 'x-large': 'XL', 'xx-large': '2XL', 'xxx-large': '3XL', 'xxxx-large': '4XL', 'xxxxx-large': '5XL' };
const SIZE_ORDER = ['xxs', 'xx-small', 'xs', 'x-small', 's', 'small', 'm', 'medium', 'l', 'large', 'xl', 'x-large', '2xl', 'xxl', 'xx-large', '3xl', 'xxxl', 'xxx-large', '4xl', 'xxxx-large', '5xl', 'xxxxx-large'];
const sizeAbbr = (name) => SIZE_ABBR[String(name).trim().toLowerCase()] || name;
const sizeRank = (name) => { const i = SIZE_ORDER.indexOf(String(name).trim().toLowerCase()); return i === -1 ? 999 : i; };

// FE blank-level availability, from /api/stock. Only combos FE explicitly
// reports out of stock are blocked — unknown products/combos stay sellable
// (fail open), and the checkout API re-checks server-side regardless.
// Key shape mirrors comboKey() in api/_lib/fulfillengine.js.
const stockKey = (color, size) => {
  const norm = v => String(v || '').trim().toLowerCase();
  const s = norm(size);
  return `${norm(color)}|${s === 'one size' ? '' : s}`;
};
const comboSoldOut = (stock, productId, color, size) =>
  (stock?.[productId]?.unavailableKeys || []).includes(stockKey(color, size));
const colorSoldOut = (stock, product, color) => (product.sizes || []).length
  ? product.sizes.every(s => comboSoldOut(stock, product.id, color, s.name))
  : comboSoldOut(stock, product.id, color, 'One Size');
const productSoldOut = (stock, product) =>
  (product.colors || []).length > 0 && !!stock?.[product.id] &&
  product.colors.every(c => colorSoldOut(stock, product, c.name));

function ProductPage() {
  const { id } = useParams();
  const { products, stock, loading } = useProducts();
  const product = products.find(p => p.id === id);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const [activeImg, setActiveImg] = useState(0);
  const { addToCart } = useCart();

  if (loading) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--gray)' }}><Loader size={24} className="spin" /></div>;
  if (!product) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--gray)' }}>Product not found</div>;

  const currentColor = product.colors[selectedColor] || product.colors[0];
  // One unified gallery for the whole product — every colorway's photos +
  // shared mockups, deduped, in a stable order. Selecting a color never hides
  // the other mockups; it just jumps the main image to that color's first shot.
  const galleryImages = (() => {
    const seen = new Set();
    const urls = [];
    for (const c of product.colors) {
      for (const im of (c?.images || [])) {
        if (im?.url && !seen.has(im.url)) { seen.add(im.url); urls.push(im.url); }
      }
    }
    if (!urls.length && product.image) urls.push(product.image);
    return urls;
  })();
  const activeImage = galleryImages[Math.min(activeImg, galleryImages.length - 1)] || product.image;
  const mainImage = activeImage;
  const selectedSizeObj = product.sizes.find(s => s.name === selectedSize);
  const totalPrice = product.price + (selectedSizeObj?.surcharge || 0);

  const allOut = productSoldOut(stock, product);
  const selectionOut = product.sizes.length
    ? (selectedSize ? comboSoldOut(stock, product.id, currentColor?.name, selectedSize) : false)
    : comboSoldOut(stock, product.id, currentColor?.name, 'One Size');
  const canAdd = !allOut && !selectionOut && (selectedSize || product.sizes.length === 0);

  const handleAdd = () => {
    if (allOut || selectionOut) return;
    // One-size products (hats, bags) have no size options — don't gate on one.
    if (!selectedSize && product.sizes.length > 0) return;
    addToCart(product, currentColor.name, selectedSize || 'One Size', mainImage, selectedSizeObj?.surcharge || 0);
  };

  return (
    <div className="pdp">
      <div className="scanlines" />
      <div className="pdp-layout">
        <div className="pdp-gallery">
          <div className="pdp-main glitch-img-wrap">
            <img className="pdp-main-img" src={activeImage} alt={product.name} />
          </div>
          {galleryImages.length > 1 && (
            <div className="pdp-thumbs">
              {galleryImages.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  className={`pdp-thumb ${i === Math.min(activeImg, galleryImages.length - 1) ? 'active' : ''}`}
                  onClick={() => setActiveImg(i)}
                >
                  <img src={url} alt={`${product.name} view ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        <motion.div
          className="pdp-info"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="pdp-breadcrumb">
            <Link to="/shop">Shop</Link> <ChevronRight size={10} style={{ margin: '0 6px' }} /> {product.name}
          </div>

          <h1 className="pdp-name">{product.name}</h1>
          <div className="pdp-price">${totalPrice.toFixed(2)}</div>
          {(() => {
            const parts = (product.description || '').split(/\s*[-•]\s+/).map(s => s.trim()).filter(Boolean);
            if (parts.length <= 1) return <p className="pdp-desc">{product.description}</p>;
            return (
              <div className="pdp-desc">
                <p>{parts[0]}</p>
                <ul className="pdp-features">
                  {parts.slice(1).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            );
          })()}

          {product.colors.length > 1 && (
            <>
              <div className="pdp-label">Color — {currentColor.name}</div>
              <div className="color-options">
                {product.colors.map((c, i) => (
                  <button
                    key={c.name}
                    className={`color-swatch ${selectedColor === i ? 'active' : ''} ${colorSoldOut(stock, product, c.name) ? 'soldout' : ''}`}
                    style={{ background: c.hex }}
                    title={colorSoldOut(stock, product, c.name) ? `${c.name} — sold out` : c.name}
                    onClick={() => {
                      setSelectedColor(i);
                      // A size that's fine in one color can be sold out in another.
                      if (selectedSize && comboSoldOut(stock, product.id, c.name, selectedSize)) setSelectedSize(null);
                      // Jump the main image to this color's first photo, but keep
                      // every thumbnail in the gallery visible.
                      const firstUrl = (c.images || [])[0]?.url;
                      const idx = firstUrl ? galleryImages.indexOf(firstUrl) : -1;
                      setActiveImg(idx >= 0 ? idx : 0);
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {product.sizes.length > 0 && (
            <>
              <div className="pdp-label">Size</div>
              <div className="size-options">
                {[...product.sizes].sort((a, b) => sizeRank(a.name) - sizeRank(b.name)).map(s => {
                  const out = comboSoldOut(stock, product.id, currentColor?.name, s.name);
                  return (
                    <button
                      key={s.name}
                      className={`size-btn ${selectedSize === s.name ? 'active' : ''} ${out ? 'soldout' : ''}`}
                      disabled={out}
                      onClick={() => setSelectedSize(s.name)}
                      title={out ? `${s.name} — sold out` : s.name}
                    >
                      <span>{sizeAbbr(s.name)}</span>
                      {s.surcharge > 0 && !out && <span className="size-surcharge">+${s.surcharge.toFixed(2)}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <button className="add-btn" onClick={handleAdd} disabled={allOut || selectionOut} style={{ opacity: canAdd ? 1 : 0.5 }}>
            {allOut ? 'Sold Out' : selectionOut ? 'Sold Out — Try Another Option' : (selectedSize || product.sizes.length === 0) ? 'Add to Cart' : 'Select a Size'} {canAdd && <ArrowRight size={14} />}
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function CollectionsPage() {
  const { products, customCategories } = useProducts();
  const rots = [-3, 2.5, -1.5, 4, -2, 3, -2.5, 1.5, -3.5, 2];

  // Build the board from the store's real categories (managed in the admin).
  const catBoards = (customCategories || []).map((c, i) => {
    const inCat = products.filter(p => (p.customCategories || []).includes(c.name));
    const img = c.image_url || inCat[0]?.image || inCat[0]?.colors?.[0]?.images?.[0]?.url || '';
    return {
      title: c.name,
      img,
      label: `${inCat.length} ${inCat.length === 1 ? 'piece' : 'pieces'}`,
      to: `/shop?category=${encodeURIComponent(c.name)}`,
      rot: rots[i % rots.length],
    };
  });

  // Fallback editorial boards only if no categories exist yet.
  const fallbackBoards = [
    { img: '/lifestyle/pizza-shop.png', label: 'Core', title: 'Essentials', to: '/shop', rot: -3 },
    { img: '/lifestyle/car-meet.png', label: 'Limited', title: 'Racing', to: '/shop', rot: 2.5 },
    { img: '/lifestyle/convertible-pink-red.png', label: 'New', title: 'Fresh Drops', to: '/shop', rot: -1.5 },
    { img: '/lifestyle/subway.png', label: 'Vintage', title: 'City Series', to: '/shop', rot: 4 },
    { img: '/lifestyle/chinatown.jpg', label: 'Street', title: 'Chinatown', to: '/shop', rot: -2 },
    { img: '/lifestyle/nyc-crosswalk.png', label: 'Lifestyle', title: 'NYC', to: '/shop', rot: 3 },
  ];

  const boards = catBoards.length > 0 ? catBoards : fallbackBoards;

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Collections</GlitchText></h1>
          <p style={{ fontSize: 15, color: 'var(--gray)', marginTop: 12 }}>Shop by category. Each one tells a story.</p>
        </motion.div>
      </div>

      <div className="board">
        <div className="board-inner">
          {boards.map((b, i) => (
            <Link
              to={b.to}
              key={b.title + i}
              className="pin-card"
              style={{
                '--rot': `${b.rot}deg`,
                '--delay': `${i * 0.4}s`,
              }}
            >
              <div className="pin" />
              <div className="pin-shadow" />
              <div className="pin-photo">
                {b.img
                  ? <img src={b.img} alt={b.title} loading="lazy" />
                  : <div className="pin-photo-empty"><span>{b.title}</span></div>}
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

      <section className="spread spread-centered">
        <div className="spread-text" style={{ alignItems: 'center', textAlign: 'center', margin: '0 auto' }}>
          <img src="/shift-logo.png" alt="Shift" style={{ width: 200, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
          <p style={{ fontSize: 15, color: 'var(--gray)', lineHeight: 1.8 }}>Your Mindset. Your Focus. Your Perspective.</p>
        </div>
      </section>
    </>
  );
}

const POLICY_PAGES = {
  shipping: {
    title: 'Shipping',
    body: [
      'Every Shift piece is made to order. Production takes 2–7 business days, and delivery adds another 3–10 business days depending on the item and where you are.',
      'Shipping is calculated at checkout. Once your order ships, tracking appears automatically in your account under My Orders — no need to email us; the tracking link updates in real time from our production partners.',
      'We currently ship within the United States.',
    ],
  },
  returns: {
    title: 'Returns',
    body: [
      'Everything we make is printed just for you, so we don\'t accept returns for sizing or change of mind — check the size guide on each product before ordering.',
      'If your order arrives damaged, misprinted, or wrong, we\'ll make it right with a free replacement or a refund. Email shift@createandsource.com within 30 days of delivery with your order number and a photo of the issue.',
    ],
  },
  privacy: {
    title: 'Privacy',
    body: [
      'We collect only what it takes to run your order: your email, shipping address, and what you bought. Payment details go directly to Stripe — we never see or store your card number.',
      'Your name and address are shared with our production partners solely so they can print and ship your order. We don\'t sell your information or share it with anyone else.',
      'Newsletter signups are used only for Shift updates, and every email includes a way out. Questions or deletion requests: shift@createandsource.com.',
    ],
  },
  terms: {
    title: 'Terms',
    body: [
      'By ordering from Shift you agree to these basics: all items are made to order and produced on demand; prices and availability can change; and once an order enters production it can\'t be modified or cancelled.',
      'We do our best to represent colors and fit accurately, but small variations between screens and garments are normal for printed apparel.',
      'Our liability is limited to the amount you paid for your order. For anything these terms don\'t cover, email shift@createandsource.com and a human will sort it out.',
    ],
  },
};

function PolicyPage() {
  const { slug } = useParams();
  const page = POLICY_PAGES[slug];
  if (!page) return <Navigate to="/" replace />;
  return (
    <>
      <div className="scanlines" />
      <div className="shop-header" style={{ paddingBottom: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: 16 }}>Info</div>
        <h1 className="shop-title">{page.title}</h1>
      </div>
      <section className="intro" style={{ paddingTop: 60 }}>
        {page.body.map((p, i) => (
          <p key={i} className="intro-body" style={i ? { marginTop: 24 } : undefined}>{p}</p>
        ))}
      </section>
    </>
  );
}

const FLAT_SHIPPING = 10;

function CheckoutPage() {
  const { cart, updateQty, cartTotal, checkout, checkingOut, checkoutError } = useCart();
  const { products } = useProducts();
  const navigate = useNavigate();
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);

  // Live shipping: real Printify rate for Printify items + flat for others.
  const hasPrintify = cart.some(i => i.product.source === 'printify');
  const hasOther = cart.some(i => (i.product.source || 'static') !== 'printify');
  const [pfShipping, setPfShipping] = useState(null);
  const [shipLoading, setShipLoading] = useState(hasPrintify);

  useEffect(() => {
    if (!hasPrintify) { setPfShipping(0); setShipLoading(false); return; }
    let cancelled = false;
    setShipLoading(true);
    fetch('/api/printify/shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(i => ({
          source: i.product.source || 'static',
          printifyProductId: i.product.printifyProductId || '',
          printifyVariantId: i.printifyVariantId || 0,
          qty: i.qty,
        })),
      }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled) setPfShipping(typeof d.shipping === 'number' ? d.shipping : FLAT_SHIPPING); })
      .catch(() => { if (!cancelled) setPfShipping(FLAT_SHIPPING); })
      .finally(() => { if (!cancelled) setShipLoading(false); });
    return () => { cancelled = true; };
  }, [cart, hasPrintify]);

  const shippingTotal = (hasPrintify ? (pfShipping ?? FLAT_SHIPPING) : 0) + (hasOther ? FLAT_SHIPPING : 0);

  const cartProductIds = new Set(cart.map(i => i.product.id));
  const suggestions = products.filter(p => !cartProductIds.has(p.id)).slice(0, 6);

  if (!cart.length) {
    return (
      <>
        <div className="scanlines" />
        <div className="ck-page">
          <div className="ck-empty">
            <ShoppingBag size={40} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h2>Your cart is empty</h2>
            <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex', marginTop: 16 }}>Continue Shopping <ArrowRight size={14} /></Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="scanlines" />
      <div className="ck-page">
        <div className="ck-container">
          <div className="ck-left">
            <Link to="/shop" className="ck-back"><ArrowLeft size={14} /> Continue Shopping</Link>
            <h1 className="ck-title"><GlitchText>Checkout</GlitchText></h1>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 32 }}>{cart.length} item{cart.length !== 1 ? 's' : ''} in your bag</p>

            <div className="ck-items">
              {cart.map(item => (
                <div key={item.key} className="ck-item">
                  <img src={item.image || item.product.image} alt={item.product.name} className="ck-item-img" />
                  <div className="ck-item-info">
                    <div className="ck-item-name">{item.product.name}</div>
                    <div className="ck-item-variant">{item.color} / {item.size}</div>
                    <div className="ck-item-price">${item.price.toFixed(2)}</div>
                    <div className="ck-item-actions">
                      <div className="cart-qty">
                        <button onClick={() => updateQty(item.key, -1)}><Minus size={12} /></button>
                        <span>{item.qty}</span>
                        <button onClick={() => updateQty(item.key, 1)}><Plus size={12} /></button>
                      </div>
                      <button className="ck-remove" onClick={() => updateQty(item.key, -item.qty)}>Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ck-right">
            <div className="ck-summary">
              <h2 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>Order Summary</h2>
              <div className="ck-summary-row">
                <span>Subtotal</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <div className="ck-summary-row">
                <span>Shipping</span>
                {!hasPrintify
                  ? <span style={{ fontSize: 12, color: 'var(--gray)' }}>Calculated at payment</span>
                  : shipLoading
                    ? <span style={{ fontSize: 12, color: 'var(--gray)' }}>Calculating…</span>
                    : <span>${shippingTotal.toFixed(2)}</span>}
              </div>
              <div className="ck-summary-row ck-summary-total">
                <span>{hasPrintify && !shipLoading ? 'Total' : 'Estimated Total'}</span>
                <span>${(cartTotal + (hasPrintify && !shipLoading ? shippingTotal : 0)).toFixed(2)}</span>
              </div>
              {checkoutError && <div className="ck-error">{checkoutError}</div>}
              <button className="ck-pay-btn" onClick={checkout} disabled={checkingOut}>
                {checkingOut ? <><Loader size={14} className="spin" /> Processing...</> : <>Pay Now <ArrowRight size={14} /></>}
              </button>
              <p className="ck-secure">
                <Lock size={12} /> Secure checkout. Your payment info is encrypted.
              </p>
            </div>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="ck-suggestions">
            <h3 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Add to Your Order</h3>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>Complete the look before you check out.</p>
            <div className="ck-suggestions-grid">
              {suggestions.map(p => (
                <div key={p.id} className="ck-suggestion" onClick={() => navigate(`/product/${p.id}`)}>
                  <img src={p.image} alt={p.name} />
                  <div className="ck-suggestion-name">{p.name}</div>
                  <div className="ck-suggestion-price">${p.price.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function OrderSuccessPage() {
  const { clearCart } = useCart();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (sessionId) clearCart();
  }, [sessionId]);

  return (
    <>
      <div className="scanlines" />
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 24px 80px', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          <CheckCircle size={48} style={{ color: 'var(--red)', marginBottom: 24 }} />
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', fontWeight: 900, textTransform: 'uppercase', marginBottom: 16 }}>
            <GlitchText>Order Confirmed</GlitchText>
          </h1>
          <p style={{ fontSize: 16, color: 'var(--gray)', maxWidth: 480, margin: '0 auto 32px', lineHeight: 1.6 }}>
            Thanks for your order. You'll receive a confirmation email shortly with tracking info once your items ship.
          </p>
          <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex' }}>
            Continue Shopping <ArrowRight size={14} />
          </Link>
        </motion.div>
      </div>
    </>
  );
}

/* ═══ ADMIN DASHBOARD ═══ */


function AdminPage() {
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem('shift-admin-pw'));
  const [adminPassword, setAdminPassword] = useState(() => sessionStorage.getItem('shift-admin-pw') || '');
  const [role, setRole] = useState(() => sessionStorage.getItem('shift-admin-role') || '');
  const [draftPassword, setDraftPassword] = useState('');
  const [status, setStatus] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const login = async (e) => {
    e.preventDefault();
    setStatus('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/admin/whoami', {
        headers: { 'x-admin-key': draftPassword },
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!data?.role) throw new Error('Invalid password');
      sessionStorage.setItem('shift-admin-pw', draftPassword);
      sessionStorage.setItem('shift-admin-role', data.role);
      setRole(data.role);
      setAdminPassword(draftPassword);
      setAuthed(true);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  // Sessions from before roles existed have a stored password but no role.
  useEffect(() => {
    if (!authed || role) return;
    fetch('/api/admin/whoami', { headers: { 'x-admin-key': adminPassword } })
      .then(r => (r.ok ? r.json() : { role: 'owner' }))
      .then(d => {
        const resolved = d?.role || 'owner';
        sessionStorage.setItem('shift-admin-role', resolved);
        setRole(resolved);
      })
      .catch(() => setRole('owner'));
  }, [authed, role, adminPassword]);

  if (!authed) {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <img src="/shift-logo.png" alt="Shift" style={{ height: 32, marginBottom: 24 }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>Shift Admin</p>
          <h2>Sign In</h2>
          <form onSubmit={login}>
            <input type="password" placeholder="Admin password" value={draftPassword} onChange={e => setDraftPassword(e.target.value)} />
            <button type="submit" disabled={loggingIn}>
              {loggingIn ? 'Verifying...' : 'Enter Admin'}
            </button>
          </form>
          {status && <p style={{ color: '#e53e3e', fontSize: 13, marginTop: 12 }}>{status}</p>}
        </div>
      </div>
    );
  }

  return <AdminDashboard adminPassword={adminPassword} role={role || 'owner'} />;
}

// Storefront newsletter signup — saves to the subscribers table via /api/subscribe.
function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [msg, setMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setMsg('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong — try again');
      setState('done');
      setMsg("You're in. Watch your inbox for the next drop.");
      setEmail('');
    } catch (err) {
      setState('error');
      setMsg(err.message);
    }
  };

  return (
    <>
      <form className="newsletter-form" onSubmit={submit}>
        <input
          type="email"
          placeholder="Your email"
          value={email}
          required
          onChange={e => setEmail(e.target.value)}
        />
        <button type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Joining…' : 'Subscribe'}
        </button>
      </form>
      {msg && <p className={`newsletter-msg ${state === 'error' ? 'err' : ''}`}>{msg}</p>}
    </>
  );
}

/* ═══ ADMIN PRODUCTS / CATEGORIES ═══ */

function AdminProductsPage({ adminPassword, role }) {
  // Two views of the same screen:
  //   owner — product.price is the TRUE source cost; the price field edits her
  //           private layer (owner_prices), which everyone else sees as "cost".
  //   staff — product.price arrives pre-masked by the API (owner price when
  //           set); the price field edits the store's retail (product_overrides).
  const isOwner = role === 'owner';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [hiddenProductIds, setHiddenProductIds] = useState([]);
  const [overrides, setOverrides] = useState({});      // productId -> { image_urls, name, price } (retail layer)
  const [ownerPrices, setOwnerPrices] = useState({});  // productId -> number (owner's private layer)
  const [priceDrafts, setPriceDrafts] = useState({});  // productId -> string (the editable price for this role)
  const [nameDrafts, setNameDrafts] = useState({});    // productId -> string (display-name edits)
  const [descOpenId, setDescOpenId] = useState(null);  // productId with the description editor open
  const [descDraft, setDescDraft] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [savingNameId, setSavingNameId] = useState(null);
  const [savingDesc, setSavingDesc] = useState(false);
  const [bulkAmount, setBulkAmount] = useState('');    // bulk markup amount (string)
  const [bulkMode, setBulkMode] = useState('pct');     // pct = % over cost, usd = $ over cost
  const [bulkScope, setBulkScope] = useState('unpriced'); // unpriced | all
  const [bulkNice99, setBulkNice99] = useState(false); // round up so prices end in .99
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // ticked products for bulk pricing
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [adminQuery, setAdminQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusMsg, setStatusMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const selectedCategory = categories.find(c => c.id === selectedCategoryId);

  const assignedProductIds = new Set(
    assignments.filter(a => a.category_id === selectedCategoryId).map(a => a.product_id)
  );

  const categoryNamesByProduct = new Map();
  const categoryById = new Map(categories.map(c => [c.id, c.name]));
  for (const a of assignments) {
    const name = categoryById.get(a.category_id);
    if (!name) continue;
    const current = categoryNamesByProduct.get(a.product_id) || [];
    current.push(name);
    categoryNamesByProduct.set(a.product_id, current);
  }

  const hiddenSet = new Set(hiddenProductIds);

  const counts = products.reduce((acc, p) => {
    acc.all++;
    if (categoryNamesByProduct.get(p.id)?.length) acc.categorized++;
    else acc.uncategorized++;
    if (assignedProductIds.has(p.id)) acc.inCategory++;
    return acc;
  }, { all: 0, categorized: 0, uncategorized: 0, inCategory: 0 });

  const visibleProducts = products.filter(p => {
    const q = adminQuery.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (categoryFilter === 'in-category') return assignedProductIds.has(p.id);
    if (categoryFilter === 'categorized') return !!categoryNamesByProduct.get(p.id)?.length;
    if (categoryFilter === 'uncategorized') return !categoryNamesByProduct.get(p.id)?.length;
    return true;
  });

  const loadData = async (selectId) => {
    setLoading(true);
    try {
      // The admin key rides along so each role sees its own version of "cost":
      // owner gets true source costs, staff gets the owner-priced feed.
      const authHeaders = { headers: { 'x-admin-key': adminPassword } };
      const [prodRes, catRes, pfRes, shRes, contentRes] = await Promise.all([
        fetch('/api/products', authHeaders),
        fetch('/api/admin/categories'),
        fetch('/api/printify/products', authHeaders).catch(() => null),
        fetch('/api/shopify/products', authHeaders).catch(() => null),
        fetch('/api/admin/content', authHeaders).catch(() => null),
      ]);
      const prodData = await prodRes.json();
      const catData = await catRes.json();
      const pfData = pfRes ? await pfRes.json().catch(() => ({ products: [] })) : { products: [] };
      const shData = shRes ? await shRes.json().catch(() => ({ products: [] })) : { products: [] };
      const contentData = contentRes ? await contentRes.json().catch(() => ({ overrides: {} })) : { overrides: {} };
      // Show ALL sources in the back end (Fulfill Engine + Printify + Shopify)
      setProducts([
        ...(prodData.products || []),
        ...(pfData.products || []),
        ...(shData.products || []),
      ]);
      setCategories(catData.categories || []);
      setAssignments(catData.assignments || []);
      setHiddenProductIds(catData.hiddenProductIds || []);
      // Seed the editable price fields (blank = passes through at cost):
      // owner edits her private layer, staff edits the store retail.
      const ov = contentData.overrides || {};
      const op = contentData.ownerPrices || {};
      setOverrides(ov);
      setOwnerPrices(op);
      const drafts = {};
      if (isOwner) {
        for (const [pid, price] of Object.entries(op)) {
          if (price != null) drafts[pid] = String(price);
        }
      } else {
        for (const [pid, o] of Object.entries(ov)) {
          if (o.price != null) drafts[pid] = String(o.price);
        }
      }
      setPriceDrafts(drafts);
      if (selectId) {
        setSelectedCategoryId(selectId);
        const cat = (catData.categories || []).find(c => c.id === selectId);
        if (cat) setCategoryNameDraft(cat.name);
      }
    } catch (err) {
      setStatusMsg(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const adminFetch = async (action, body = {}) => {
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
  };

  const contentFetch = async (action, body = {}) => {
    const res = await fetch('/api/admin/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
  };

  // Save (or clear) the price for one product. Blank = revert to cost.
  // Owner writes her private layer; staff writes the store retail
  // (preserving any photo/name override on the same product).
  const savePrice = async (product) => {
    const raw = (priceDrafts[product.id] ?? '').trim();
    if (isOwner) {
      const prevOwner = ownerPrices[product.id] != null ? String(ownerPrices[product.id]) : '';
      if (raw === prevOwner) return; // unchanged — no write
      let price = null;
      if (raw !== '') {
        price = Number(raw);
        if (isNaN(price) || price < 0) { setStatusMsg('Enter a valid price'); return; }
      }
      setSavingId(product.id);
      try {
        await contentFetch('setOwnerPrice', { productId: product.id, price });
        setOwnerPrices(o => {
          const n = { ...o };
          if (price == null) delete n[product.id];
          else n[product.id] = price;
          return n;
        });
        setStatusMsg(price == null ? `Reset to cost: ${product.name}` : `Your price saved: ${product.name} → $${price.toFixed(2)}`);
      } catch (err) {
        setStatusMsg(err.message);
      }
      setSavingId(null);
      return;
    }
    const cur = overrides[product.id] || {};
    const prev = cur.price != null ? String(cur.price) : '';
    if (raw === prev) return; // unchanged — no write
    let price = null;
    if (raw !== '') {
      price = Number(raw);
      if (isNaN(price) || price < 0) { setStatusMsg('Enter a valid price'); return; }
    }
    setSavingId(product.id);
    try {
      const hasOtherOverride = (cur.image_urls?.length || 0) > 0 || !!cur.name || !!cur.description;
      if (price == null && !hasOtherOverride) {
        await contentFetch('clearOverride', { productId: product.id });
        setOverrides(o => { const n = { ...o }; delete n[product.id]; return n; });
      } else {
        await contentFetch('setOverride', {
          productId: product.id,
          imageUrls: cur.image_urls || [],
          name: cur.name || null,
          price,
          description: cur.description || null,
        });
        setOverrides(o => ({ ...o, [product.id]: { image_urls: cur.image_urls || [], name: cur.name || null, price, description: cur.description || null } }));
      }
      setStatusMsg(price == null ? `Reset to cost: ${product.name}` : `Price saved: ${product.name} → $${price.toFixed(2)}`);
    } catch (err) {
      setStatusMsg(err.message);
    }
    setSavingId(null);
  };

  // Save (or clear) a product's display name. Typing the original name back
  // (or blanking the field) removes the rename. Preserves photos + retail.
  const saveName = async (product) => {
    const cur = overrides[product.id] || {};
    let draft = (nameDrafts[product.id] ?? '').trim();
    if (draft === product.name) draft = '';
    if (nameDrafts[product.id] == null || draft === (cur.name || '')) return; // untouched or unchanged
    setSavingNameId(product.id);
    try {
      const hasOther = (cur.image_urls?.length || 0) > 0 || cur.price != null || !!cur.description;
      if (!draft && !hasOther) {
        await contentFetch('clearOverride', { productId: product.id });
        setOverrides(o => { const n = { ...o }; delete n[product.id]; return n; });
      } else {
        await contentFetch('setOverride', {
          productId: product.id,
          imageUrls: cur.image_urls || [],
          name: draft || null,
          price: cur.price ?? null,
          description: cur.description || null,
        });
        setOverrides(o => ({ ...o, [product.id]: { image_urls: cur.image_urls || [], name: draft || null, price: cur.price ?? null, description: cur.description || null } }));
      }
      setStatusMsg(draft ? `Renamed to “${draft}”` : `Name reset: ${product.name}`);
      setNameDrafts(d => { const n = { ...d }; delete n[product.id]; return n; });
    } catch (err) {
      setStatusMsg(err.message);
    }
    setSavingNameId(null);
  };

  // Save (or clear) a product's store description. Empty = back to original.
  const saveDescription = async (product) => {
    const cur = overrides[product.id] || {};
    let draft = descDraft.trim();
    if (draft === (product.description || '').trim()) draft = ''; // retyping the original = clear
    setSavingDesc(true);
    try {
      const hasOther = (cur.image_urls?.length || 0) > 0 || !!cur.name || cur.price != null;
      if (!draft && !hasOther) {
        await contentFetch('clearOverride', { productId: product.id });
        setOverrides(o => { const n = { ...o }; delete n[product.id]; return n; });
      } else {
        await contentFetch('setOverride', {
          productId: product.id,
          imageUrls: cur.image_urls || [],
          name: cur.name || null,
          price: cur.price ?? null,
          description: draft || null,
        });
        setOverrides(o => ({ ...o, [product.id]: { image_urls: cur.image_urls || [], name: cur.name || null, price: cur.price ?? null, description: draft || null } }));
      }
      setStatusMsg(draft ? `Description saved: ${product.name}` : `Description reset: ${product.name}`);
      setDescOpenId(null);
    } catch (err) {
      setStatusMsg(err.message);
    }
    setSavingDesc(false);
  };

  const openDescEditor = (product) => {
    if (descOpenId === product.id) { setDescOpenId(null); return; }
    setDescDraft(overrides[product.id]?.description || product.description || '');
    setDescOpenId(product.id);
  };

  // ── Bulk pricing: cost + markup across many products in one click ──
  // "Priced" means priced in THIS role's layer. Ticking product checkboxes
  // (when no category is selected) narrows the bulk apply to just those.
  const hasPrice = (pid) => (isOwner ? ownerPrices[pid] != null : overrides[pid]?.price != null);
  const pickingForBulk = !selectedCategoryId && selectedIds.size > 0;
  const bulkTargets = pickingForBulk
    ? products.filter(p => selectedIds.has(p.id))
    : products.filter(p => bulkScope === 'all' || !hasPrice(p.id));
  const unpricedCount = products.filter(p => !hasPrice(p.id)).length;

  const toggleSelected = (productId, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  };

  const computeBulkPrice = (cost) => {
    const amt = Number(bulkAmount);
    let p = bulkMode === 'pct' ? cost * (1 + amt / 100) : cost + amt;
    if (bulkNice99) p = Math.max(0.99, Math.ceil(p) - 0.01);
    return Math.round(p * 100) / 100;
  };

  const bulkAmountValid = bulkAmount.trim() !== '' && !isNaN(Number(bulkAmount)) && Number(bulkAmount) > 0;

  const applyBulk = async () => {
    if (!bulkAmountValid) { setStatusMsg('Enter a markup amount first'); return; }
    if (!bulkTargets.length) { setStatusMsg('No products to price'); return; }
    const amt = Number(bulkAmount);
    const label = bulkMode === 'pct' ? `cost + ${amt}%` : `cost + $${amt.toFixed(2)}`;
    if (!confirm(`Price ${bulkTargets.length} product${bulkTargets.length === 1 ? '' : 's'} at ${label}${bulkNice99 ? ' (ending .99)' : ''}?`)) return;
    setBulkSaving(true);
    try {
      const prices = {};
      for (const p of bulkTargets) prices[p.id] = computeBulkPrice(p.price);
      const data = await contentFetch(isOwner ? 'bulkSetOwnerPrices' : 'bulkSetPrices', { prices });
      setSelectedIds(new Set());
      await loadData(selectedCategoryId);
      setStatusMsg(`Priced ${data.count} products at ${label}`);
    } catch (err) {
      setStatusMsg(err.message);
    }
    setBulkSaving(false);
  };

  const createCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const data = await adminFetch('createCategory', { name: newCategoryName });
      setNewCategoryName('');
      await loadData(data.category?.id);
      setStatusMsg('Category created');
    } catch (err) { setStatusMsg(err.message); }
  };

  const updateCategory = async (e) => {
    e.preventDefault();
    if (!selectedCategoryId || !categoryNameDraft.trim() || categoryNameDraft.trim() === selectedCategory?.name) return;
    try {
      await adminFetch('updateCategory', { categoryId: selectedCategoryId, name: categoryNameDraft.trim() });
      await loadData(selectedCategoryId);
      setStatusMsg('Category updated');
    } catch (err) { setStatusMsg(err.message); }
  };

  const deleteCategory = async () => {
    if (!selectedCategoryId || !confirm('Delete this category?')) return;
    try {
      await adminFetch('deleteCategory', { categoryId: selectedCategoryId });
      setSelectedCategoryId('');
      setCategoryNameDraft('');
      await loadData();
      setStatusMsg('Category deleted');
    } catch (err) { setStatusMsg(err.message); }
  };

  const toggleAssignment = async (productId, checked) => {
    if (!selectedCategoryId) return;
    // Optimistic update
    setAssignments(prev => checked
      ? [...prev, { product_id: productId, category_id: selectedCategoryId }]
      : prev.filter(a => !(a.product_id === productId && a.category_id === selectedCategoryId))
    );
    try {
      await adminFetch(checked ? 'assignProduct' : 'unassignProduct', {
        categoryId: selectedCategoryId,
        productId,
      });
    } catch (err) {
      setStatusMsg(err.message);
      await loadData(selectedCategoryId);
    }
  };

  const toggleHidden = async (productId, hide) => {
    setHiddenProductIds(prev => hide
      ? [...new Set([...prev, productId])]
      : prev.filter(id => id !== productId)
    );
    try {
      await adminFetch(hide ? 'hideProduct' : 'showProduct', { productId });
    } catch (err) {
      setStatusMsg(err.message);
      await loadData(selectedCategoryId);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>;

  return (
    <div className="admin-cat-layout">
      {/* Sidebar: categories */}
      <div className="admin-cat-sidebar">
        <form className="admin-cat-create" onSubmit={createCategory}>
          <label>New Category</label>
          <input type="text" placeholder="e.g. Hoodies" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
          <button type="submit">Add</button>
        </form>
        <div className="admin-cat-list">
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`admin-cat-item ${cat.id === selectedCategoryId ? 'active' : ''}`}
              onClick={() => { setSelectedCategoryId(cat.id); setCategoryNameDraft(cat.name); setCategoryFilter('in-category'); }}
            >
              <span>{cat.name}</span>
              <strong>{assignments.filter(a => a.category_id === cat.id).length}</strong>
            </button>
          ))}
        </div>
      </div>

      {/* Main: product list */}
      <div className="admin-cat-main">
        <div className="admin-cat-head">
          <div>
            <h2>{selectedCategory?.name || 'All Products'}</h2>
            {statusMsg && <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>{statusMsg}</p>}
          </div>
          <div className="admin-cat-actions">
            <input type="search" placeholder="Search products..." value={adminQuery} onChange={e => setAdminQuery(e.target.value)} />
            <button onClick={() => loadData(selectedCategoryId)}>Refresh</button>
            {selectedCategoryId && <button onClick={deleteCategory} style={{ color: '#e53e3e' }}>Delete Category</button>}
          </div>
        </div>

        <div className="admin-cat-filters">
          {[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'in-category', label: 'In Category', count: counts.inCategory },
            { value: 'categorized', label: 'Categorized', count: counts.categorized },
            { value: 'uncategorized', label: 'Uncategorized', count: counts.uncategorized },
          ].map(opt => (
            <button key={opt.value} className={categoryFilter === opt.value ? 'active' : ''} onClick={() => setCategoryFilter(opt.value)}>
              {opt.label} <span>{opt.count}</span>
            </button>
          ))}
        </div>

        <div className="admin-bulk-price">
          <div className="admin-bulk-price-head">
            <label>Bulk pricing</label>
            <small>
              {isOwner
                ? 'Cost + your markup = your price. The rest of the admin — and the store — sees your price as the product cost. '
                : 'Cost + your markup = the store’s retail price, across many products at once. Unpriced products sell at cost. '}
              Tip: tick the checkboxes to price only those products.
            </small>
          </div>
          <div className="admin-bulk-price-row">
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder={bulkMode === 'pct' ? 'e.g. 40' : 'e.g. 10'}
              value={bulkAmount}
              onChange={e => setBulkAmount(e.target.value)}
            />
            <select value={bulkMode} onChange={e => setBulkMode(e.target.value)}>
              <option value="pct">% over cost</option>
              <option value="usd">$ over cost</option>
            </select>
            {pickingForBulk ? (
              <span className="admin-bulk-picked">
                {selectedIds.size} ticked
                <button type="button" onClick={() => setSelectedIds(new Set())}>clear</button>
              </span>
            ) : (
              <select value={bulkScope} onChange={e => setBulkScope(e.target.value)}>
                <option value="unpriced">Only unpriced ({unpricedCount})</option>
                <option value="all">All products ({products.length})</option>
              </select>
            )}
            <label className="admin-bulk-99">
              <input type="checkbox" checked={bulkNice99} onChange={e => setBulkNice99(e.target.checked)} />
              end in .99
            </label>
            <button onClick={applyBulk} disabled={bulkSaving}>
              {bulkSaving ? 'Applying…' : `Apply to ${bulkTargets.length}`}
            </button>
          </div>
          {bulkAmountValid && bulkTargets.length > 0 && (() => {
            const ex = bulkTargets[0];
            const sell = computeBulkPrice(ex.price);
            const profit = sell - ex.price;
            return (
              <small className="admin-price-earn">
                Example: {ex.name} — cost ${ex.price.toFixed(2)} → ${sell.toFixed(2)} · you earn ${profit.toFixed(2)}
              </small>
            );
          })()}
        </div>

        {selectedCategoryId && (
          <form className="admin-cat-edit" onSubmit={updateCategory}>
            <label>Edit category name</label>
            <div>
              <input type="text" value={categoryNameDraft} onChange={e => setCategoryNameDraft(e.target.value)} />
              <button type="submit" disabled={!categoryNameDraft.trim() || categoryNameDraft.trim() === selectedCategory?.name}>Save Name</button>
            </div>
          </form>
        )}

        <div className="admin-cat-products">
          {visibleProducts.map(product => {
            const isHidden = hiddenSet.has(product.id);
            const productCats = categoryNamesByProduct.get(product.id) || [];
            return (
              <div key={product.id} className={`admin-cat-product ${isHidden ? 'hidden-product' : ''}`}>
                <input
                  type="checkbox"
                  title={selectedCategoryId ? 'In this category' : 'Tick products to bulk-price just those'}
                  checked={selectedCategoryId ? assignedProductIds.has(product.id) : selectedIds.has(product.id)}
                  onChange={e => (selectedCategoryId
                    ? toggleAssignment(product.id, e.target.checked)
                    : toggleSelected(product.id, e.target.checked))}
                />
                <img src={product.image} alt="" />
                <div className="admin-cat-product-info">
                  <span className="admin-cat-product-name">
                    <input
                      className="admin-name-input"
                      type="text"
                      title="Product name shown on the store — click to edit"
                      value={nameDrafts[product.id] ?? (overrides[product.id]?.name || product.name)}
                      onChange={e => setNameDrafts(d => ({ ...d, [product.id]: e.target.value }))}
                      onBlur={() => saveName(product)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                    {savingNameId === product.id && <Loader size={12} className="spin" />}
                  </span>
                  {overrides[product.id]?.name && (
                    <small className="admin-name-orig">was: {product.name}</small>
                  )}
                  <div className="admin-cat-tags">
                    {isHidden && <small className="tag-hidden">Hidden</small>}
                    {productCats.length ? productCats.map(c => <small key={c}>{c}</small>) : <small className="tag-empty">Uncategorized</small>}
                  </div>
                </div>
                <div className="admin-price-cell">
                  <small className="admin-price-cost">Cost ${product.price.toFixed(2)}</small>
                  <label className="admin-price-input">
                    <span>$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      placeholder={product.price.toFixed(2)}
                      value={priceDrafts[product.id] ?? ''}
                      onChange={e => setPriceDrafts(d => ({ ...d, [product.id]: e.target.value }))}
                      onBlur={() => savePrice(product)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                    {savingId === product.id && <Loader size={12} className="spin" />}
                  </label>
                  {(() => {
                    const raw = priceDrafts[product.id];
                    const sell = raw != null && raw !== '' && !isNaN(Number(raw)) ? Number(raw) : product.price;
                    const profit = sell - product.price;
                    const margin = sell > 0 ? Math.round((profit / sell) * 100) : 0;
                    if (profit > 0) return <small className="admin-price-earn">You earn ${profit.toFixed(2)} · {margin}%</small>;
                    if (profit < 0) return <small className="admin-price-earn neg">Below cost −${Math.abs(profit).toFixed(2)}</small>;
                    return <small className="admin-price-earn flat">At cost — $0 profit</small>;
                  })()}
                  {isOwner && (() => {
                    const retail = overrides[product.id]?.price;
                    const mine = ownerPrices[product.id];
                    const storePrice = retail ?? mine ?? product.price;
                    return (
                      <small className="admin-price-retail">
                        Store: ${Number(storePrice).toFixed(2)}
                        {retail != null
                          ? ` · her cut $${(retail - (mine ?? product.price)).toFixed(2)}`
                          : ' (no retail yet)'}
                      </small>
                    );
                  })()}
                </div>
                <button className="admin-cat-hide-btn" onClick={() => toggleHidden(product.id, !isHidden)}>
                  {isHidden ? 'Show' : 'Hide'}
                </button>
                <button
                  className={`admin-cat-hide-btn admin-desc-btn ${overrides[product.id]?.description ? 'has-desc' : ''}`}
                  title="Edit the product description shown on the store"
                  onClick={() => openDescEditor(product)}
                >
                  Description
                </button>
                {descOpenId === product.id && (
                  <div className="admin-desc-editor">
                    <textarea
                      rows={4}
                      value={descDraft}
                      onChange={e => setDescDraft(e.target.value)}
                      placeholder="Product description shown on the store…"
                    />
                    <div className="admin-desc-actions">
                      <button className="admin-desc-save" onClick={() => saveDescription(product)} disabled={savingDesc}>
                        {savingDesc ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setDescDraft(product.description || '')}>Use original</button>
                      <button onClick={() => setDescOpenId(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══ ADMIN MEDIA — uploads, category photos, custom products ═══ */

// Resize/compress an image File to a data URL so uploads stay small + fast.
function fileToResizedDataUrl(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const isPng = /png/i.test(file.type);
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(file, { folder, name, adminPassword }) {
  const dataUrl = await fileToResizedDataUrl(file);
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
    body: JSON.stringify({ dataUrl, folder, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

function AdminMediaPage({ adminPassword }) {
  const [section, setSection] = useState('categories'); // categories | overrides
  const [categories, setCategories] = useState([]);
  const [feedProducts, setFeedProducts] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [ovSearch, setOvSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [catRes, contentRes, prodRes, pfRes, shRes] = await Promise.all([
        fetch('/api/admin/categories'),
        fetch('/api/admin/content'),
        fetch('/api/products'),
        fetch('/api/printify/products').catch(() => null),
        fetch('/api/shopify/products').catch(() => null),
      ]);
      const catData = await catRes.json();
      const content = await contentRes.json();
      const prodData = await prodRes.json();
      const pfData = pfRes ? await pfRes.json().catch(() => ({ products: [] })) : { products: [] };
      const shData = shRes ? await shRes.json().catch(() => ({ products: [] })) : { products: [] };
      setCategories(catData.categories || []);
      setOverrides(content.overrides || {});
      setFeedProducts([...(prodData.products || []), ...(pfData.products || []), ...(shData.products || [])]);
    } catch (e) { setStatusMsg(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
  };

  const withBusy = async (label, fn) => {
    setBusy(true); setStatusMsg(label);
    try { await fn(); }
    catch (e) { setStatusMsg(e.message); setBusy(false); return; }
    setBusy(false);
  };

  // ── Category photos ──
  const setCategoryPhoto = (catId, file) => withBusy('Uploading photo…', async () => {
    const url = await uploadImageFile(file, { folder: 'categories', name: 'category', adminPassword });
    await post('/api/admin/categories', { action: 'setCategoryImage', categoryId: catId, imageUrl: url });
    setStatusMsg('Category photo saved ✓');
    await load();
  });
  const clearCategoryPhoto = (catId) => withBusy('Removing…', async () => {
    await post('/api/admin/categories', { action: 'setCategoryImage', categoryId: catId, imageUrl: null });
    await load();
  });

  // ── Overrides on feed products ──
  const addOverrideImage = (product, file) => withBusy('Uploading mockup…', async () => {
    const url = await uploadImageFile(file, { folder: 'overrides', name: product.name, adminPassword });
    const cur = overrides[product.id] || {};
    await post('/api/admin/content', {
      action: 'setOverride',
      productId: product.id,
      imageUrls: [...(cur.image_urls || []), url],
      name: cur.name || null,
      price: cur.price ?? null,
      description: cur.description || null,
    });
    setStatusMsg('Mockup added ✓');
    await load();
  });
  const clearOverride = (productId) => withBusy('Clearing…', async () => {
    await post('/api/admin/content', { action: 'clearOverride', productId });
    await load();
  });
  // Persist a new ordering (or empty = clear) of a product's uploaded mockups.
  const saveOverrideImages = (product, imageUrls) => withBusy('Saving…', async () => {
    const cur = overrides[product.id] || {};
    // Only delete the row when nothing else lives on it — a rename, retail
    // price, or description must survive removing the last uploaded photo.
    if (imageUrls.length === 0 && !cur.name && cur.price == null && !cur.description) {
      await post('/api/admin/content', { action: 'clearOverride', productId: product.id });
    } else {
      await post('/api/admin/content', {
        action: 'setOverride', productId: product.id, imageUrls,
        name: cur.name || null, price: cur.price ?? null,
        description: cur.description || null,
      });
    }
    await load();
  });
  const moveOverrideImage = (product, index, dir) => {
    const arr = [...(overrides[product.id]?.image_urls || [])];
    const j = index + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    saveOverrideImages(product, arr);
  };
  const removeOverrideImage = (product, index) => {
    const arr = [...(overrides[product.id]?.image_urls || [])];
    arr.splice(index, 1);
    saveOverrideImages(product, arr);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>;

  const filteredFeed = feedProducts.filter(p =>
    !ovSearch || p.name.toLowerCase().includes(ovSearch.toLowerCase()));

  return (
    <div className="admin-media">
      <div className="admin-media-tabs">
        <button className={section === 'categories' ? 'active' : ''} onClick={() => setSection('categories')}>Category Photos</button>
        <button className={section === 'overrides' ? 'active' : ''} onClick={() => setSection('overrides')}>Product Photos</button>
      </div>
      {statusMsg && <div className="admin-media-status">{busy && <Loader size={12} className="spin" />} {statusMsg}</div>}

      {/* ── Category Photos ── */}
      {section === 'categories' && (
        <div className="admin-media-body">
          <p className="admin-media-hint">Give each category a photo. It shows in the “Shop by Category” grid on the homepage and as tiles on the Shop page. (Create categories in the Products tab.)</p>
          {categories.length === 0 && <p className="admin-media-empty">No categories yet — add some under the Products tab first.</p>}
          <div className="admin-media-grid">
            {categories.map(cat => (
              <div key={cat.id} className="admin-media-card">
                <div className="admin-media-thumb" style={cat.image_url ? { backgroundImage: `url(${cat.image_url})` } : {}}>
                  {!cat.image_url && <span>No photo</span>}
                </div>
                <div className="admin-media-card-body">
                  <strong>{cat.name}</strong>
                  <div className="admin-media-card-actions">
                    <label className="admin-upload-btn">
                      {cat.image_url ? 'Replace' : 'Upload photo'}
                      <input type="file" accept="image/*" disabled={busy} onChange={e => e.target.files[0] && setCategoryPhoto(cat.id, e.target.files[0])} />
                    </label>
                    {cat.image_url && <button className="admin-link-btn" disabled={busy} onClick={() => clearCategoryPhoto(cat.id)}>Remove</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Product Photos (overrides) ── */}
      {section === 'overrides' && (
        <div className="admin-media-body">
          <p className="admin-media-hint">Add your own mockups to any product. Use the <strong>‹ ›</strong> arrows to order them — the first one leads on the storefront — and <strong>×</strong> to delete. Your photos show <strong>alongside</strong> the originals.</p>
          <input className="admin-media-search" placeholder="Search products…" value={ovSearch} onChange={e => setOvSearch(e.target.value)} />
          <div className="admin-photo-list">
            {filteredFeed.map(p => {
              const imgs = overrides[p.id]?.image_urls || [];
              const original = p.image || p.colors?.[0]?.images?.[0]?.url;
              return (
                <div key={p.id} className="admin-photo-row">
                  <div className="admin-photo-row-head">
                    <div className="admin-media-thumb sm" style={original ? { backgroundImage: `url(${original})` } : {}}>{!original && <span>—</span>}</div>
                    <div>
                      <strong title={p.name}>{p.name}</strong>
                      <div className="admin-src-tag">{p.source} · {imgs.length} uploaded</div>
                    </div>
                  </div>
                  <div className="admin-photo-strip">
                    {imgs.map((url, idx) => (
                      <div key={url + idx} className="admin-photo-item" style={{ backgroundImage: `url(${url})` }}>
                        {idx === 0 && <span className="admin-photo-lead">Leads</span>}
                        <div className="admin-photo-ctrls">
                          <button title="Move earlier" disabled={busy || idx === 0} onClick={() => moveOverrideImage(p, idx, -1)}>‹</button>
                          <button title="Delete" className="del" disabled={busy} onClick={() => removeOverrideImage(p, idx)}>×</button>
                          <button title="Move later" disabled={busy || idx === imgs.length - 1} onClick={() => moveOverrideImage(p, idx, 1)}>›</button>
                        </div>
                      </div>
                    ))}
                    <label className="admin-thumb-add lg">+
                      <input type="file" accept="image/*" disabled={busy} onChange={e => e.target.files[0] && addOverrideImage(p, e.target.files[0])} />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboard({ adminPassword, role }) {
  const [adminPage, setAdminPage] = useState('orders');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const logout = () => {
    sessionStorage.removeItem('shift-admin-pw');
    sessionStorage.removeItem('shift-admin-role');
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="admin">
      <div className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="admin-menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
            <Menu size={20} />
          </button>
          <img src="/shift-logo.png" alt="Shift" style={{ height: 28 }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888' }}>Admin</span>
          <span style={{ fontSize: 10, color: '#bbb', fontWeight: 600 }} title="Build version">v-{typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : 'dev'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/" style={{ fontSize: 12, color: '#888', textDecoration: 'none', fontWeight: 600 }}>View Store</a>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="admin-menu-overlay" onClick={() => setMenuOpen(false)}>
          <nav className="admin-menu-panel" onClick={e => e.stopPropagation()}>
            <button className="admin-menu-close" onClick={() => setMenuOpen(false)}><X size={20} /></button>
            <button className={adminPage === 'products' ? 'active' : ''} onClick={() => { setAdminPage('products'); setMenuOpen(false); }}>Products</button>
            <button className={adminPage === 'media' ? 'active' : ''} onClick={() => { setAdminPage('media'); setMenuOpen(false); }}>Media</button>
            <button className={adminPage === 'orders' ? 'active' : ''} onClick={() => { setAdminPage('orders'); setMenuOpen(false); }}>Orders</button>
            <button className={adminPage === 'subscribers' ? 'active' : ''} onClick={() => { setAdminPage('subscribers'); setMenuOpen(false); }}>Subscribers</button>
            <button className={adminPage === 'atcost' ? 'active' : ''} onClick={() => { setAdminPage('atcost'); setMenuOpen(false); }}>Order at Cost</button>
          </nav>
        </div>
      )}

      {adminPage === 'orders' && <AdminOrdersPage adminPassword={adminPassword} role={role} />}
      {adminPage === 'products' && <AdminProductsPage adminPassword={adminPassword} role={role} />}
      {adminPage === 'media' && <AdminMediaPage adminPassword={adminPassword} />}
      {adminPage === 'subscribers' && <AdminSubscribersPage adminPassword={adminPassword} />}
      {adminPage === 'atcost' && <AdminOrderAtCostPage adminPassword={adminPassword} />}
    </div>
  );
}

// Wholesale ordering: buy any product at this login's cost — staff pays her
// cost, owner pays true cost. Runs through the normal Stripe checkout, so
// orders record + auto-fulfill (Printify/Shopify) exactly like retail ones.
function AdminOrderAtCostPage({ adminPassword }) {
  const [products, setProducts] = useState(null);
  const [cart, setCart] = useState([]);
  const [sel, setSel] = useState({});    // productId -> { color, size }
  const [query, setQuery] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const h = { headers: { 'x-admin-key': adminPassword } };
        const [a, b, c] = await Promise.all([
          fetch('/api/products', h).then(r => r.json()).catch(() => ({})),
          fetch('/api/printify/products', h).then(r => r.json()).catch(() => ({})),
          fetch('/api/shopify/products', h).then(r => r.json()).catch(() => ({})),
        ]);
        setProducts([...(a.products || []), ...(b.products || []), ...(c.products || [])]);
      } catch {
        setProducts([]);
      }
    })();
  }, []);

  const addItem = (p) => {
    const chosen = sel[p.id] || {};
    const color = chosen.color || p.colors?.[0]?.name || '';
    const sizeObj = p.sizes?.length ? (p.sizes.find(s => s.name === chosen.size) || p.sizes[0]) : null;
    const size = sizeObj?.name || '';
    const price = p.price + (sizeObj?.surcharge || 0);
    const key = `${p.id}-${color}-${size}`;
    const printifyVariantId = p.variantMap?.[`${color}|${size}`] ?? null;
    setCart(prev => {
      const ex = prev.find(i => i.key === key);
      if (ex) return prev.map(i => (i.key === key ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { key, product: p, color, size, qty: 1, price, printifyVariantId }];
    });
  };

  const bumpQty = (key, delta) => {
    setCart(prev => prev
      .map(i => (i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i))
      .filter(i => i.qty > 0));
  };

  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  const checkout = async () => {
    if (!cart.length || checkingOut) return;
    setCheckingOut(true);
    setMsg('');
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(i => ({
            productId: i.product.id,
            name: i.product.name,
            price: i.price,
            qty: i.qty,
            color: i.color,
            size: i.size,
            image: i.product.image,
            source: i.product.source || 'static',
            printifyProductId: i.product.printifyProductId || '',
            printifyVariantId: i.printifyVariantId || 0,
          })),
          shipping: 10,
        }),
      });
      const data = await res.json();
      if (!data.url) throw new Error(data.message || data.error || 'Checkout failed');
      window.location.href = data.url;
    } catch (err) {
      setMsg(err.message);
      setCheckingOut(false);
    }
  };

  if (products == null) return <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>;

  const visible = products.filter(p => !query || p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="admin-atcost">
      <div className="admin-atcost-head">
        <div>
          <h2>Order at Cost</h2>
          <p>Buy anything at your cost — samples, stock, gifts. Ships like a normal order; shipping is added at checkout.</p>
        </div>
      </div>

      {cart.length > 0 && (
        <div className="admin-atcost-cart">
          {cart.map(i => (
            <div key={i.key} className="admin-atcost-cart-row">
              <span className="admin-atcost-cart-name">{i.product.name} <small>{[i.color, i.size].filter(Boolean).join(' / ')}</small></span>
              <span className="admin-atcost-qty">
                <button onClick={() => bumpQty(i.key, -1)}>−</button>
                {i.qty}
                <button onClick={() => bumpQty(i.key, 1)}>+</button>
              </span>
              <span className="admin-atcost-line">${(i.price * i.qty).toFixed(2)}</span>
            </div>
          ))}
          <div className="admin-atcost-checkout">
            <span>Total <strong>${total.toFixed(2)}</strong> <small>+ shipping</small></span>
            <button onClick={checkout} disabled={checkingOut}>
              {checkingOut ? 'Opening checkout…' : 'Checkout'}
            </button>
          </div>
          {msg && <p className="admin-atcost-err">{msg}</p>}
        </div>
      )}

      <input className="admin-media-search" placeholder="Search products…" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="admin-atcost-list">
        {visible.map(p => {
          const chosen = sel[p.id] || {};
          return (
            <div key={p.id} className="admin-atcost-row">
              <img src={p.image} alt="" />
              <div className="admin-atcost-info">
                <strong>{p.name}</strong>
                <small>Cost ${p.price.toFixed(2)}</small>
              </div>
              {(p.colors?.length || 0) > 1 && (
                <select value={chosen.color || p.colors[0].name} onChange={e => setSel(s => ({ ...s, [p.id]: { ...s[p.id], color: e.target.value } }))}>
                  {p.colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              )}
              {(p.sizes?.length || 0) > 0 && (
                <select value={chosen.size || p.sizes[0].name} onChange={e => setSel(s => ({ ...s, [p.id]: { ...s[p.id], size: e.target.value } }))}>
                  {p.sizes.map(s => <option key={s.name} value={s.name}>{s.name}{s.surcharge ? ` (+$${s.surcharge.toFixed(2)})` : ''}</option>)}
                </select>
              )}
              <button className="admin-atcost-add" onClick={() => addItem(p)}>Add</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Newsletter signups from the storefront "Join the Movement" form.
function AdminSubscribersPage({ adminPassword }) {
  const [subs, setSubs] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/subscribe', { headers: { 'x-admin-key': adminPassword } })
      .then(r => r.json())
      .then(d => setSubs(d.subscribers || []))
      .catch(() => setSubs([]));
  }, []);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText((subs || []).map(s => s.email).join('\n'));
      setMsg(`Copied ${subs.length} email${subs.length === 1 ? '' : 's'}`);
    } catch {
      setMsg('Copy failed — select them manually');
    }
  };

  if (subs == null) return <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>;

  return (
    <div className="admin-subs">
      <div className="admin-subs-head">
        <div>
          <h2>Subscribers</h2>
          <p>{subs.length} signed up for drops{msg ? ` · ${msg}` : ''}</p>
        </div>
        {subs.length > 0 && <button onClick={copyAll}>Copy all emails</button>}
      </div>
      {subs.length === 0 ? (
        <div className="admin-subs-empty">No subscribers yet — signups from the “Join the Movement” form land here.</div>
      ) : (
        <div className="admin-subs-list">
          {subs.map(s => (
            <div key={s.email} className="admin-subs-row">
              <span>{s.email}</span>
              <small>{new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminOrdersPage({ adminPassword, role }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [costMap, setCostMap] = useState(null);        // productId -> this role's cost basis
  const [ownerPrices, setOwnerPrices] = useState({});  // owner layer (owner login only)
  const [csvFrom, setCsvFrom] = useState('');          // profit report date range
  const [csvTo, setCsvTo] = useState('');
  const [settled, setSettled] = useState({});          // 'YYYY-MM-DD' week start -> paid row
  const [settleMsg, setSettleMsg] = useState('');

  // Cost basis for profit math — the feeds answer per-role (owner: true cost,
  // staff: the owner's price), so the same view shows each her own profit.
  useEffect(() => {
    (async () => {
      try {
        const h = { headers: { 'x-admin-key': adminPassword } };
        const [a, b, c, content] = await Promise.all([
          fetch('/api/products', h).then(r => r.json()).catch(() => ({})),
          fetch('/api/printify/products', h).then(r => r.json()).catch(() => ({})),
          fetch('/api/shopify/products', h).then(r => r.json()).catch(() => ({})),
          fetch('/api/admin/content', h).then(r => r.json()).catch(() => ({})),
        ]);
        const m = {};
        for (const p of [...(a.products || []), ...(b.products || []), ...(c.products || [])]) m[p.id] = p.price;
        setCostMap(m);
        setOwnerPrices(content.ownerPrices || {});
      } catch {
        setCostMap({});
      }
    })();
  }, []);

  // What this login earns on one order item. Staff: retail − her cost.
  // Owner: her private price − true cost (the partner's cut is hers to keep).
  // Items carry a purchase-time cost snapshot (it.cost / it.owner_price, the
  // API already masks per role) — exact, immune to later price changes. Orders
  // from before snapshotting fall back to current catalog costs.
  const itemEarn = (it) => {
    const qty = it.quantity || 1;
    if (it.cost != null) {
      const cost = Number(it.cost);
      if (role === 'owner') return (Number(it.owner_price ?? cost) - cost) * qty;
      return (Number(it.unit_price) - cost) * qty;
    }
    if (!costMap) return null;
    const cost = costMap[it.product_id];
    if (cost == null) return null;
    if (role === 'owner') {
      const mine = ownerPrices[it.product_id];
      return (Number(mine ?? cost) - cost) * qty;
    }
    return (Number(it.unit_price) - cost) * qty;
  };

  // True when every item's profit comes from the purchase-time snapshot.
  const orderExact = (o) => (o.items || []).length > 0 && o.items.every(it => it.cost != null);

  const orderEarn = (order) => {
    const items = order.items || [];
    if (!items.length) return null;
    let sum = 0, any = false;
    for (const it of items) {
      const e = itemEarn(it);
      if (e != null) { sum += e; any = true; }
    }
    return any ? sum : null;
  };

  const profitTotals = (() => {
    if (!costMap || !orders.length) return null;
    let revenue = 0, earn = 0, counted = 0, estimated = 0;
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      revenue += Number(o.subtotal ?? o.total) || 0;
      const e = orderEarn(o);
      if (e != null) { earn += e; counted++; if (!orderExact(o)) estimated++; }
    }
    return { revenue, earn, counted, estimated, total: orders.filter(o => o.status !== 'cancelled').length };
  })();

  // Friday settlement — what the store pays Create & Source out of each
  // Friday Stripe payout: every item at the store's cost (C&S fronts the
  // production bill) plus the shipping the customer paid (C&S pays the real
  // shipping). Weeks run Friday→Thursday; payment is due the next Friday.
  // Staff's item.cost IS her cost; the owner reads her private layer directly —
  // both roles land on the same dollar amount.
  const itemPayable = (it) => {
    const qty = it.quantity || 1;
    if (it.cost != null) {
      const c = role === 'owner' ? Number(it.owner_price ?? it.cost) : Number(it.cost);
      return { amount: c * qty, exact: true };
    }
    const base = costMap ? costMap[it.product_id] : null;
    if (base == null) return null;
    const c = role === 'owner' ? Number(ownerPrices[it.product_id] ?? base) : Number(base);
    return { amount: c * qty, exact: false };
  };

  const settlementWeeks = (() => {
    // Needs every order — hidden while a status filter narrows the list.
    if (filter !== 'all' || !costMap || !orders.length) return null;
    const weekStart = (iso) => {
      const d = new Date(iso);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7)); // back to Friday
      return d;
    };
    const weeks = new Map();
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const ws = weekStart(o.created_at);
      let w = weeks.get(ws.getTime());
      if (!w) weeks.set(ws.getTime(), w = { start: ws, items: 0, retail: 0, shipping: 0, orders: 0, estimated: 0, unknown: 0 });
      w.orders++;
      w.shipping += Number(o.shipping_cost ?? (o.total - o.subtotal)) || 0;
      for (const it of o.items || []) {
        const p = itemPayable(it);
        if (p == null) { w.unknown++; continue; }
        w.items += p.amount;
        w.retail += Number(it.unit_price) * (it.quantity || 1);
        if (!p.exact) w.estimated++;
      }
    }
    return [...weeks.values()].sort((a, b) => b.start - a.start);
  })();

  // Paid tracking for the settlement weeks — rows live in the settlements
  // table, keyed by the week's Friday as a local YYYY-MM-DD date.
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    fetch('/api/admin/orders?view=settlements', { headers: { 'x-admin-key': adminPassword } })
      .then(r => r.json())
      .then(d => {
        const m = {};
        for (const s of d.settlements || []) m[s.week_start] = s;
        setSettled(m);
      })
      .catch(() => {});
  }, []);

  const markSettled = async (w, paid) => {
    if (!paid && !confirm('Unmark this week as paid?')) return;
    const weekStart = ymd(w.start);
    const amount = +(w.items + w.shipping).toFixed(2);
    setSettleMsg('');
    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify({ action: 'markSettled', weekStart, amount, paid }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setSettleMsg(data.error || 'Could not save'); return; }
    setSettled(prev => {
      const next = { ...prev };
      if (paid) next[weekStart] = { week_start: weekStart, amount, paid_at: new Date().toISOString() };
      else delete next[weekStart];
      return next;
    });
  };

  // Tax/profit report: one CSV row per item in the date range, using this
  // login's own numbers (the same per-role math as the strip). Snapshot rows
  // are exact; pre-snapshot rows are flagged as estimates.
  const downloadCsv = () => {
    const from = csvFrom ? new Date(csvFrom + 'T00:00:00') : null;
    const to = csvTo ? new Date(csvTo + 'T23:59:59') : null;
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const header = ['Date', 'Order', 'Status', 'Product', 'Color', 'Size', 'Qty', 'Sale price'];
    if (role === 'owner') header.push('Your price');
    header.push('Cost', 'Profit', 'Cost basis');
    const lines = [header.map(esc).join(',')];
    let revenue = 0, profit = 0, itemCount = 0, estimatedRows = 0, unknownRows = 0;
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const d = new Date(o.created_at);
      if ((from && d < from) || (to && d > to)) continue;
      for (const it of o.items || []) {
        const qty = it.quantity || 1;
        const sale = Number(it.unit_price) || 0;
        const snap = it.cost != null;
        const cost = snap ? Number(it.cost) : (costMap ? costMap[it.product_id] : null) ?? null;
        const mine = role === 'owner'
          ? (snap ? Number(it.owner_price ?? cost) : (cost != null ? Number(ownerPrices[it.product_id] ?? cost) : null))
          : null;
        const line = cost == null ? null : (role === 'owner' ? (mine - cost) : (sale - cost)) * qty;
        const row = [
          d.toISOString().slice(0, 10),
          '#' + o.id.slice(0, 8),
          o.status,
          it.product_name,
          it.color || '',
          it.size || '',
          qty,
          sale.toFixed(2),
        ];
        if (role === 'owner') row.push(mine != null ? mine.toFixed(2) : '');
        row.push(
          cost != null ? cost.toFixed(2) : '',
          line != null ? line.toFixed(2) : '',
          cost == null ? 'unknown (product left the catalog)' : (snap ? 'exact (locked at purchase)' : 'estimated (current catalog cost)')
        );
        lines.push(row.map(esc).join(','));
        revenue += sale * qty;
        itemCount++;
        if (line != null) profit += line;
        if (cost == null) unknownRows++; else if (!snap) estimatedRows++;
      }
    }
    lines.push('');
    lines.push([esc('TOTAL SALES'), esc(revenue.toFixed(2))].join(','));
    lines.push([esc(role === 'owner' ? 'TOTAL YOU EARN' : 'TOTAL PROFIT'), esc(profit.toFixed(2))].join(','));
    lines.push([esc('ITEMS'), esc(itemCount)].join(','));
    lines.push([esc('NOTE'), esc('Sales exclude shipping charges. Cancelled orders excluded.')].join(','));
    if (estimatedRows || unknownRows) {
      lines.push([esc('NOTE'), esc(`${estimatedRows} line(s) estimated at current catalog costs, ${unknownRows} with unknown cost — orders from before cost snapshotting.`)].join(','));
    }
    const range = (csvFrom || csvTo) ? `${csvFrom || 'start'}-to-${csvTo || 'today'}` : 'all-time';
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift-profit-report-${range}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const fetchOrders = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/orders?status=${filter}`, {
      headers: { 'x-admin-key': adminPassword },
    });
    const data = await res.json();
    setOrders(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchOrders(); }, [filter]);

  // Keep the open detail panel in sync after a refresh (recovered address,
  // new fulfillment backlinks) — orders are replaced wholesale on fetch.
  useEffect(() => {
    if (selected) {
      const fresh = orders.find(o => o.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [orders]);

  // Pull the latest tracking from Printify + Shopify onto in-flight orders.
  const syncTracking = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const res = await fetch('/api/sync-tracking', { headers: { 'x-admin-key': adminPassword } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSyncMsg(data.updated > 0
        ? `Updated tracking on ${data.updated} order${data.updated === 1 ? '' : 's'}.`
        : 'No new tracking yet — checked ' + (data.scanned || 0) + '.');
      await fetchOrders();
    } catch (err) {
      setSyncMsg(err.message);
    }
    setSyncing(false);
  };

  // One-time: register the real-time tracking webhooks with Printify + Shopify.
  const setupWebhooks = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const res = await fetch('/api/setup-webhooks', { headers: { 'x-admin-key': adminPassword } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      const shortTopic = (t = '') => t.toLowerCase().replace(/^orders?[_/:]?/, '').replace(/[_:]/g, ' ');
      const detail = (arr) => (Array.isArray(arr) ? arr : [])
        .map(x => `${shortTopic(x.topic) || x.status}: ${x.status === 'error' ? '✗ ' + x.error : (x.status.startsWith('already') ? 'on' : x.status)}`)
        .join('  ·  ');
      setSyncMsg(`SHOPIFY → ${detail(data.shopify) || 'n/a'}    |    PRINTIFY → ${detail(data.printify) || 'n/a'}`);
    } catch (err) {
      setSyncMsg(err.message);
    }
    setSyncing(false);
  };

  const updateOrder = async (orderId, updates) => {
    await fetch('/api/admin/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify({ orderId, ...updates }),
    });
    fetchOrders();
    if (selected?.id === orderId) {
      setSelected(prev => ({ ...prev, ...updates }));
    }
  };

  const statuses = ['all', 'new', 'processing', 'shipped', 'delivered', 'cancelled'];
  const statusColors = { new: '#e53e3e', processing: '#dd6b20', shipped: '#3182ce', delivered: '#38a169', cancelled: '#718096' };

  return (
    <>
      <div className="admin-stats">
        {['new', 'processing', 'shipped', 'delivered'].map(s => {
          const count = orders.filter(o => filter === 'all' ? o.status === s : true).length;
          return filter === 'all' ? (
            <div key={s} className="admin-stat" onClick={() => setFilter(s)} style={{ cursor: 'pointer' }}>
              <div className="admin-stat-count" style={{ color: statusColors[s] }}>{orders.filter(o => o.status === s).length}</div>
              <div className="admin-stat-label">{s}</div>
            </div>
          ) : null;
        })}
        {filter === 'all' && (
          <div className="admin-stat">
            <div className="admin-stat-count">{orders.length}</div>
            <div className="admin-stat-label">total</div>
          </div>
        )}
      </div>

      <div className="admin-filters">
        {statuses.map(s => (
          <button key={s} className={`filter-btn ${filter === s ? 'active' : ''}`} onClick={() => { setFilter(s); setSelected(null); }}>
            {s === 'all' ? 'All Orders' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        {role === 'owner' && (
          <button className="filter-btn sync-btn" onClick={setupWebhooks} disabled={syncing} style={{ marginLeft: 'auto' }} title="One-time: turn on real-time tracking updates">
            Enable real-time
          </button>
        )}
        <button className="filter-btn sync-btn" onClick={syncTracking} disabled={syncing} style={role === 'owner' ? undefined : { marginLeft: 'auto' }}>
          {syncing ? <><Loader size={12} className="spin" /> Syncing…</> : <><Truck size={12} /> Sync tracking</>}
        </button>
      </div>
      {syncMsg && <div style={{ padding: '0 24px 8px', fontSize: 12, color: 'var(--gray)' }}>{syncMsg}</div>}

      {profitTotals && (
        <div className="admin-profit-strip">
          <div>
            <small>Sales</small>
            <strong>${profitTotals.revenue.toFixed(2)}</strong>
          </div>
          <div>
            <small>You earn</small>
            <strong className="earn">${profitTotals.earn.toFixed(2)}</strong>
          </div>
          <span className="admin-profit-note">
            {filter === 'all' ? 'All orders' : `${filter} orders`}
            {profitTotals.estimated > 0 ? ` · ${profitTotals.estimated} order(s) estimated at current costs` : ' · exact purchase-time costs'}
            {profitTotals.counted < profitTotals.total ? ` · ${profitTotals.total - profitTotals.counted} order(s) not counted (product no longer in the catalog)` : ''}
          </span>
        </div>
      )}

      {settlementWeeks && settlementWeeks.length > 0 && (
        <div className="admin-settle">
          <div className="admin-settle-head">
            <span className="admin-export-label">{role === 'owner' ? 'Create & Source settlement — what the store pays you' : 'Pay Create & Source'}</span>
            <span className="admin-settle-hint">
              {role === 'owner'
                ? 'Her cost on every item + shipping collected, grouped by payout week (Fri–Thu).'
                : 'Your cost on every item + the shipping your customers paid — Create & Source fronts the production and shipping bills. Pay each amount on its Friday, when that week’s Stripe payout lands. “You keep” is before Stripe’s card fees.'}
            </span>
          </div>
          {settlementWeeks.map(w => {
            const due = new Date(w.start); due.setDate(due.getDate() + 7);
            const end = new Date(w.start); end.setDate(end.getDate() + 6);
            const open = new Date() < due;
            const fmt = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <div key={w.start.getTime()} className="admin-settle-row">
                <div className="admin-settle-due">
                  <small>Due {fmt(due)}</small>
                  <strong style={open ? { color: '#dd6b20' } : undefined}>${(w.items + w.shipping).toFixed(2)}</strong>
                </div>
                <span className="admin-settle-detail">
                  {fmt(w.start)} – {fmt(end)} · {w.orders} order{w.orders === 1 ? '' : 's'} · ${w.items.toFixed(2)} product + ${w.shipping.toFixed(2)} shipping · customers paid ${(w.retail + w.shipping).toFixed(2)}, {role === 'owner' ? 'she keeps' : 'you keep'} ${(w.retail - w.items).toFixed(2)}
                  {open ? ' · week still open — final Thursday night' : ''}
                  {w.estimated > 0 ? ` · ${w.estimated} item(s) at current catalog cost (pre-snapshot order)` : ''}
                  {w.unknown > 0 ? ` · ${w.unknown} item(s) missing a cost — not included` : ''}
                </span>
                {(() => {
                  const s = settled[ymd(w.start)];
                  if (!s) return <button className="filter-btn" style={{ marginLeft: 'auto' }} onClick={() => markSettled(w, true)}>Mark paid</button>;
                  const drift = s.amount != null && Math.abs(Number(s.amount) - (w.items + w.shipping)) > 0.01;
                  return (
                    <span className="admin-settle-paidwrap">
                      <span className="admin-settle-paid">
                        Paid ✓ {new Date(s.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {s.amount != null ? ` · $${Number(s.amount).toFixed(2)}` : ''}
                      </span>
                      {drift && <span className="admin-settle-drift">now computes ${(w.items + w.shipping).toFixed(2)}</span>}
                      <button className="admin-settle-undo" onClick={() => markSettled(w, false)} title="Unmark as paid">×</button>
                    </span>
                  );
                })()}
              </div>
            );
          })}
          {settleMsg && <span className="admin-settle-hint" style={{ color: '#e53e3e' }}>{settleMsg}</span>}
        </div>
      )}

      {orders.length > 0 && (
        <div className="admin-export-bar">
          <span className="admin-export-label">Profit report</span>
          <input type="date" value={csvFrom} onChange={e => setCsvFrom(e.target.value)} aria-label="From date" />
          <span className="admin-export-dash">to</span>
          <input type="date" value={csvTo} onChange={e => setCsvTo(e.target.value)} aria-label="To date" />
          <button className="filter-btn" onClick={downloadCsv}><Download size={12} /> Download CSV</button>
          <span className="admin-export-hint">Every item with its cost and profit — for taxes pick Jan 1 to Dec 31. Blank dates = everything.</span>
        </div>
      )}

      <div className="admin-content">
        <div className="admin-orders-list">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}><Loader size={20} className="spin" /></div>
          ) : orders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>No orders</div>
          ) : (
            orders.map(order => (
              <div
                key={order.id}
                className={`admin-order-row ${selected?.id === order.id ? 'selected' : ''}`}
                onClick={() => setSelected(order)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>#{order.id.slice(0, 8)}</span>
                  <span className="status-badge" style={{ background: statusColors[order.status] + '22', color: statusColors[order.status] }}>
                    {order.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                  {order.customer?.name || order.customer?.email || 'Guest'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--gray)' }}>{new Date(order.created_at).toLocaleDateString()}</span>
                  <span style={{ fontWeight: 600 }}>${Number(order.total).toFixed(2)}</span>
                </div>
                {(() => {
                  const e = orderEarn(order);
                  if (e == null || order.status === 'cancelled') return null;
                  return <div className="admin-order-earn">You earn ${e.toFixed(2)}</div>;
                })()}
                {order.fulfillment_error && order.status !== 'cancelled' && (
                  <div className="admin-fulfill-flag">⚠ Fulfillment issue</div>
                )}
              </div>
            ))
          )}
        </div>

        {selected && <AdminOrderDetail order={selected} onUpdate={updateOrder} onClose={() => setSelected(null)} adminPassword={adminPassword} onRefresh={fetchOrders} role={role} />}
      </div>
    </>
  );
}

function AdminOrderDetail({ order, onUpdate, onClose, adminPassword, onRefresh, role }) {
  const [tracking, setTracking] = useState(order.tracking_number || '');
  const [trackingUrl, setTrackingUrl] = useState(order.tracking_url || '');
  const [notes, setNotes] = useState(order.admin_notes || '');
  const [busy, setBusy] = useState(false);
  const [fulfillMsg, setFulfillMsg] = useState('');

  useEffect(() => {
    setTracking(order.tracking_number || '');
    setTrackingUrl(order.tracking_url || '');
    setNotes(order.admin_notes || '');
    setFulfillMsg('');
  }, [order.id]);

  // Pull the address from the order's Stripe session — for orders recorded
  // before the webhook read the right Stripe field.
  const recoverAddress = async () => {
    setBusy(true); setFulfillMsg('');
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
        body: JSON.stringify({ action: 'recoverAddress', orderId: order.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recovery failed');
      setFulfillMsg('Address recovered from Stripe.');
      onRefresh?.();
    } catch (err) {
      setFulfillMsg(err.message);
    }
    setBusy(false);
  };

  // Dry-run validate against Fulfill Engine, then really submit.
  const sendToFE = async () => {
    setBusy(true); setFulfillMsg('Validating with Fulfill Engine…');
    try {
      const call = (validate) => fetch('/api/admin/fe-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
        body: JSON.stringify({ orderId: order.id, validate }),
      }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error + (d.detail ? ' — ' + JSON.stringify(d.detail).slice(0, 300) : '')); return d; });
      await call(true);
      setFulfillMsg('Validated ✓ — submitting…');
      const real = await call(false);
      setFulfillMsg(`Sent to Fulfill Engine ✓ (${real.feItems} item${real.feItems === 1 ? '' : 's'}). It will produce and ship.`);
      onRefresh?.();
    } catch (err) {
      setFulfillMsg(err.message);
    }
    setBusy(false);
  };

  const addr = order.shipping_address || {};
  const statusColors = { new: '#e53e3e', processing: '#dd6b20', shipped: '#3182ce', delivered: '#38a169', cancelled: '#718096' };
  const nextStatus = { new: 'processing', processing: 'shipped', shipped: 'delivered' };

  return (
    <div className="admin-order-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Order #{order.id.slice(0, 8)}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Status</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="status-badge" style={{ background: statusColors[order.status] + '22', color: statusColors[order.status], fontSize: 13 }}>
            {order.status}
          </span>
          {nextStatus[order.status] && (
            <button className="admin-action-btn" onClick={() => onUpdate(order.id, { status: nextStatus[order.status] })}>
              Mark as {nextStatus[order.status]}
            </button>
          )}
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <button className="admin-action-btn" style={{ color: '#e53e3e' }} onClick={() => {
              if (confirm('Cancel this order?')) onUpdate(order.id, { status: 'cancelled' });
            }}>Cancel</button>
          )}
          {order.status === 'cancelled' && role === 'owner' && (
            <button className="admin-action-btn" style={{ color: '#e53e3e' }} disabled={busy} onClick={async () => {
              if (!confirm('Delete this order permanently? It disappears from every report and cannot be undone.')) return;
              setBusy(true);
              try {
                const res = await fetch(`/api/admin/orders?orderId=${order.id}`, {
                  method: 'DELETE',
                  headers: { 'x-admin-key': adminPassword },
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Delete failed');
                onClose();
                onRefresh?.();
              } catch (err) {
                setFulfillMsg(err.message);
                setBusy(false);
              }
            }}>Delete permanently</button>
          )}
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Customer</div>
        <div>{order.customer?.name || '—'}</div>
        <div style={{ fontSize: 13, color: 'var(--gray)' }}>{order.customer?.email}</div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Shipping Address</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {addr.name && <div style={{ fontWeight: 600 }}>{addr.name}</div>}
          {addr.line1 && <div>{addr.line1}</div>}
          {addr.line2 && <div>{addr.line2}</div>}
          <div>{[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}</div>
          {addr.country && <div>{addr.country}</div>}
          {addr.phone && <div style={{ color: 'var(--gray)' }}>{addr.phone}</div>}
          {!addr.line1 && !addr.city && <div style={{ color: 'var(--gray)' }}>No address on file</div>}
        </div>
        {!addr.line1 && !addr.city && (
          <button className="admin-action-btn" style={{ marginTop: 8 }} onClick={recoverAddress} disabled={busy}>
            Recover address from Stripe
          </button>
        )}
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Fulfillment</div>
        {order.fulfillment_error && (
          <div className="admin-fulfill-error">
            <div className="admin-fulfill-error-title">⚠ Fulfillment issue</div>
            {order.fulfillment_error}
            <div className="admin-fulfill-error-hint">A successful Send to Fulfill Engine / Send to Shopify clears this banner.</div>
          </div>
        )}
        {order.fe_order_id ? (
          <div style={{ fontSize: 13 }}>Fulfill Engine order: {order.fe_order_id}</div>
        ) : (
          <button className="admin-action-btn" onClick={sendToFE} disabled={busy}>
            Send to Fulfill Engine
          </button>
        )}
        {order.printify_order_id && <div style={{ fontSize: 13, marginTop: 6 }}>Printify order: {order.printify_order_id}</div>}
        {order.shopify_order_id && <div style={{ fontSize: 13, marginTop: 6 }}>Shopify order: {order.shopify_order_id}</div>}
        <button className="admin-action-btn" style={{ marginTop: 8 }} disabled={busy} onClick={async () => {
          setBusy(true); setFulfillMsg('Creating Shopify order (draft flow)…');
          try {
            const call = (force) => fetch('/api/admin/shopify-submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
              body: JSON.stringify({ orderId: order.id, force }),
            }).then(async r => ({ ok: r.ok, status: r.status, d: await r.json() }));
            let { ok, status, d } = await call(false);
            if (!ok && status === 409 && d.canForce) {
              if (confirm(`${d.error}.\n\nSend a NEW Shopify order anyway? Only do this if the old one was cancelled in Shopify — otherwise both will produce.`)) {
                ({ ok, d } = await call(true));
              } else { setFulfillMsg('Not re-sent.'); setBusy(false); return; }
            }
            if (!ok) throw new Error(d.error + (d.detail ? ' — ' + JSON.stringify(d.detail).slice(0, 300) : ''));
            setFulfillMsg(`Sent to Shopify ✓ ${d.order?.name || ''} (${d.items} item${d.items === 1 ? '' : 's'}) — Tapstitch imports it within a minute.`);
            onRefresh?.();
          } catch (err) { setFulfillMsg(err.message); }
          setBusy(false);
        }}>Send to Shopify</button>
        <button className="admin-action-btn" style={{ marginTop: 8, fontSize: 11 }} disabled={busy} onClick={async () => {
          setBusy(true); setFulfillMsg('Fetching FE debug data…');
          try {
            const res = await fetch('/api/admin/fe-submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
              body: JSON.stringify({ orderId: order.id, debug: true }),
            });
            setFulfillMsg(JSON.stringify(await res.json(), null, 1));
          } catch (err) { setFulfillMsg(err.message); }
          setBusy(false);
        }}>FE debug</button>
        {fulfillMsg && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{fulfillMsg}</div>}
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Items</div>
        {(order.items || []).map((item, i) => (
          <div key={i} className="admin-item-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{[item.color, item.size].filter(Boolean).join(' / ')}</div>
            </div>
            <div style={{ fontSize: 13, textAlign: 'right' }}>
              <div>x{item.quantity}</div>
              <div>${Number(item.unit_price).toFixed(2)}</div>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
          <span>Total</span>
          <span>${Number(order.total).toFixed(2)}</span>
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Tracking</div>
        <input placeholder="Tracking number" value={tracking} onChange={e => setTracking(e.target.value)} className="admin-input" />
        <input placeholder="Tracking URL (optional)" value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)} className="admin-input" style={{ marginTop: 8 }} />
        <button className="admin-action-btn" style={{ marginTop: 8 }} onClick={() => onUpdate(order.id, { tracking_number: tracking, tracking_url: trackingUrl })}>
          Save Tracking
        </button>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Notes</div>
        <textarea placeholder="Internal notes..." value={notes} onChange={e => setNotes(e.target.value)} className="admin-input" rows={3} />
        <button className="admin-action-btn" style={{ marginTop: 8 }} onClick={() => onUpdate(order.id, { admin_notes: notes })}>
          Save Notes
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 16 }}>
        Created: {new Date(order.created_at).toLocaleString()}<br />
        Updated: {new Date(order.updated_at).toLocaleString()}
      </div>
    </div>
  );
}

/* ═══ CUSTOMER PORTAL ═══ */

function AccountPage() {
  const { user, loading, signOut } = useAuth();
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { cart } = useCart();
  const [wasLoggedOut, setWasLoggedOut] = useState(!user);

  // Redirect to checkout after sign-in if cart has items
  useEffect(() => {
    if (wasLoggedOut && user && cart.length > 0) {
      navigate('/checkout');
    }
    if (user) setWasLoggedOut(false);
  }, [user]);

  // The reset link in the email lands the user back here with a recovery
  // session — show the set-new-password card instead of the dashboard. The
  // hash check catches a mid-load arrival; the auth event is the backstop.
  const [recovery, setRecovery] = useState(() =>
    window.location.hash.includes('type=recovery') || sessionStorage.getItem('shift-recovery') === '1');
  const [newPassword, setNewPassword] = useState('');
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    // Email links must land back on THIS deployment — without this they fall
    // back to the Supabase project's Site URL (which once pointed at localhost).
    const emailRedirectTo = `${window.location.origin}/account`;

    if (authMode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: emailRedirectTo });
      if (error) setError(error.message);
      else setMessage('Reset link sent — check your email.');
      return;
    }

    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      return;
    }

    if (authMode === 'signup') {
      // Email confirmation is off — a real signup returns a session and the
      // page flips to the dashboard on its own. An existing email returns a
      // fake user with no session (Supabase's enumeration guard).
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else if (data?.user && !data.session) setError('An account with this email already exists — use Sign In or "Forgot password?".');
    }
  };

  const saveNewPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setError(error.message);
    else { sessionStorage.removeItem('shift-recovery'); setRecovery(false); }
  };

  if (loading) return <div style={{ padding: '200px 0', textAlign: 'center' }}><Loader size={24} className="spin" /></div>;

  if (user && recovery) {
    return (
      <>
        <div className="scanlines" />
        <div className="portal-auth">
          <div className="portal-auth-card">
            <img src="/shift-logo.png" alt="Shift" style={{ height: 36, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>New Password</h2>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>Choose a new password for {user.email}</p>
            <form onSubmit={saveNewPassword}>
              <input type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="portal-input" />
              <button type="submit" className="portal-btn">Save Password</button>
            </form>
            {error && <div style={{ color: '#e53e3e', fontSize: 13, marginTop: 12 }}>{error}</div>}
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <div className="scanlines" />
        <div className="portal-auth">
          <div className="portal-auth-card">
            <img src="/shift-logo.png" alt="Shift" style={{ height: 36, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>My Account</h2>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>
              {authMode === 'reset' ? "We'll email you a link to reset your password"
                : cart.length > 0 ? 'Sign in to continue to checkout' : 'Track your orders and manage your account'}
            </p>

            {authMode !== 'reset' && (
              <div className="portal-auth-tabs">
                <button className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setError(''); setMessage(''); }}>Sign In</button>
                <button className={authMode === 'signup' ? 'active' : ''} onClick={() => { setAuthMode('signup'); setError(''); setMessage(''); }}>Sign Up</button>
              </div>
            )}

            <form onSubmit={handleAuth}>
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="portal-input" />
              {authMode !== 'reset' && (
                <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="portal-input" />
              )}
              <button type="submit" className="portal-btn">
                {authMode === 'reset' ? 'Send Reset Link' : authMode === 'signup' ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            {authMode === 'login' && (
              <button type="button" className="portal-forgot" onClick={() => { setAuthMode('reset'); setError(''); setMessage(''); }}>
                Forgot password?
              </button>
            )}
            {authMode === 'reset' && (
              <button type="button" className="portal-forgot" onClick={() => { setAuthMode('login'); setError(''); setMessage(''); }}>
                Back to sign in
              </button>
            )}

            {error && <div style={{ color: '#e53e3e', fontSize: 13, marginTop: 12 }}>{error}</div>}
            {message && <div style={{ color: '#38a169', fontSize: 13, marginTop: 12 }}>{message}</div>}
          </div>
        </div>
      </>
    );
  }

  return <CustomerDashboard user={user} onLogout={signOut} />;
}

function CustomerDashboard({ user, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    async function load() {
      // Get customer's orders via the anon key (RLS filters to their orders).
      // Items list explicit columns: the cost-snapshot columns are revoked for
      // customer keys, so a * select would be rejected outright.
      const { data } = await supabase
        .from('orders')
        .select('*, items:order_items(product_name, color, size, quantity, unit_price)')
        .order('created_at', { ascending: false });
      setOrders(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const statusSteps = ['new', 'processing', 'shipped', 'delivered'];
  const statusLabels = { new: 'Order Placed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered' };
  const statusIcons = { new: Package, processing: Clock, shipped: Truck, delivered: CheckCircle };

  return (
    <>
      <div className="scanlines" />
      <div className="portal">
        <div className="portal-header">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>My Orders</h1>
            <p style={{ fontSize: 13, color: 'var(--gray)' }}>{user.email}</p>
          </div>
          <button onClick={onLogout} className="portal-logout">
            <LogOut size={14} /> Sign Out
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--gray)' }}>
            <Package size={32} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p>No orders yet</p>
            <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex', marginTop: 16 }}>Start Shopping <ArrowRight size={14} /></Link>
          </div>
        ) : (
          <div className="portal-orders">
            {orders.map(order => (
              <div key={order.id} className="portal-order-card" onClick={() => setSelected(selected?.id === order.id ? null : order)}>
                <div className="portal-order-top">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Order #{order.id.slice(0, 8)}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{new Date(order.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>${Number(order.total).toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: order.status === 'delivered' ? '#38a169' : 'var(--red)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{order.status}</div>
                  </div>
                </div>

                {/* Status timeline */}
                <div className="portal-timeline">
                  {statusSteps.map((step, i) => {
                    const currentIdx = statusSteps.indexOf(order.status === 'cancelled' ? 'new' : order.status);
                    const active = i <= currentIdx;
                    const Icon = statusIcons[step];
                    return (
                      <div key={step} className={`portal-timeline-step ${active ? 'active' : ''}`}>
                        <div className="portal-timeline-dot"><Icon size={12} /></div>
                        <span>{statusLabels[step]}</span>
                        {i < statusSteps.length - 1 && <div className={`portal-timeline-line ${i < currentIdx ? 'active' : ''}`} />}
                      </div>
                    );
                  })}
                </div>

                {order.status === 'cancelled' && (
                  <div style={{ fontSize: 13, color: '#e53e3e', fontWeight: 600, marginTop: 8 }}>This order was cancelled</div>
                )}

                {selected?.id === order.id && (
                  <div className="portal-order-detail">
                    <div className="portal-detail-label">Items</div>
                    {(order.items || []).map((item, i) => (
                      <div key={i} className="portal-item-row">
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--gray)' }}>{[item.color, item.size].filter(Boolean).join(' / ')} x{item.quantity}</div>
                        </div>
                        <div style={{ fontWeight: 600 }}>${(Number(item.unit_price) * item.quantity).toFixed(2)}</div>
                      </div>
                    ))}

                    {order.tracking_number && (
                      <div style={{ marginTop: 16 }}>
                        <div className="portal-detail-label">Tracking</div>
                        {order.tracking_url ? (
                          <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)', fontSize: 13 }}>
                            {order.tracking_number} <ArrowRight size={12} />
                          </a>
                        ) : (
                          <span style={{ fontSize: 13 }}>{order.tracking_number}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const location = window.location.pathname;
  const isAdmin = location.startsWith('/dashadmin');

  // Admin routes don't need the store layout
  if (isAdmin) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/dashadmin" element={<AdminPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <ProductsProvider>
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
              <Route path="/info/:slug" element={<PolicyPage />} />
              <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
              <Route path="/order-success" element={<OrderSuccessPage />} />
              <Route path="/account" element={<AccountPage />} />
            </Routes>
            <Footer />
          </CartProvider>
        </ProductsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
