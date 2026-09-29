/* CampusLink – board logic
   Listings you post are stored in this browser only (localStorage).
   To share listings between users, replace the storage calls with a real backend. */

// ---------- Data ----------

var CATEGORIES = [
  "Tutoring",
  "Design & Tech",
  "Writing & Typing",
  "Beauty & Fashion",
  "Food & Delivery",
  "Repairs",
  "Errands"
];

// Sample listings shown on first load. Replace these with real ones.
var SEED = [
  {
    id: "s1",
    type: "offer",
    cat: "Tutoring",
    title: "Calculus and physics tutoring",
    desc: "Weekly small-group sessions with worked past questions. Weekday evenings.",
    name: "Ada O.",
    uni: "Engineering, 400L",
    price: "2,500 per hour",
    contact: "ada.tutor@example.com"
  },
  {
    id: "s2",
    type: "request",
    cat: "Design & Tech",
    title: "Poster and flyer for society week",
    desc: "Need two A3 posters and a social media flyer by Friday. Brand colours provided.",
    name: "Tobi A.",
    uni: "Mass Comm, 200L",
    price: "Budget 8,000",
    contact: "08000000001"
  },
];

// A few starting likes and reviews so the demo doesn't look empty.
// Real listings (posted through the form) start with none of these.
var SEED_ENGAGEMENT = {
  s1: {
    likes: 14,
    reviews: [
      { name: "Femi O.", rating: 5, text: "Explained limits way better than my lecturer. Booking again." },
      { name: "Grace T.", rating: 4, text: "Very patient, only wish sessions were longer." }
    ]
  },
  s3: {
    likes: 9,
    reviews: [
      { name: "Blessing U.", rating: 5, text: "Fixed my screen in an hour, fair price." }
    ]
  },
  s4: {
    likes: 21,
    reviews: [
      { name: "Aisha M.", rating: 5, text: "Neat cornrows, didn't rush at all." },
      { name: "Ruth P.", rating: 5, text: "Best braider on campus honestly." }
    ]
  },
  s6: {
    likes: 17,
    reviews: [
      { name: "David K.", rating: 4, text: "Food is good and delivery was on time." }
    ]
  },
  s8: {
    likes: 11,
    reviews: []
  }
};

// ---------- State ----------

// Current filters chosen by the visitor
var filters = { type: "all", cat: "All", q: "" };

// Listings posted by the visitor (loaded from this browser's storage)
var posts = [];
try {
  posts = JSON.parse(localStorage.getItem("cl_posts") || "[]");
} catch (e) {
  posts = [];
}

// Likes and reviews added by the visitor, keyed by listing id
// (loaded from this browser's storage; see SEED_ENGAGEMENT for starting values)
var engagementStore = {};
try {
  engagementStore = JSON.parse(localStorage.getItem("cl_engagement") || "{}");
} catch (e) {
  engagementStore = {};
}

function saveEngagement() {
  try {
    localStorage.setItem("cl_engagement", JSON.stringify(engagementStore));
  } catch (e) {
    // Storage may be blocked; the change still shows for this visit
  }
}

// Gets (or creates) this visitor's stored entry for one listing
function getEntry(id) {
  if (!engagementStore[id]) {
    engagementStore[id] = { likedByMe: false, reviews: [] };
  }
  return engagementStore[id];
}

function getLikeCount(id) {
  var base = (SEED_ENGAGEMENT[id] && SEED_ENGAGEMENT[id].likes) || 0;
  var entry = engagementStore[id];
  return base + (entry && entry.likedByMe ? 1 : 0);
}

function getReviews(id) {
  var base = (SEED_ENGAGEMENT[id] && SEED_ENGAGEMENT[id].reviews) || [];
  var entry = engagementStore[id];
  return base.concat(entry ? entry.reviews : []);
}

function getAverageRating(id) {
  var reviews = getReviews(id);
  if (!reviews.length) return 0;
  var total = reviews.reduce(function (sum, review) {
    return sum + review.rating;
  }, 0);
  return total / reviews.length;
}

function renderStars(rating) {
  var rounded = Math.round(rating);
  var stars = "";
  for (var i = 1; i <= 5; i++) {
    stars += i <= rounded ? "★" : "☆";
  }
  return stars;
}

// ---------- Helpers ----------

function $(selector) {
  return document.querySelector(selector);
}

// Turns text into safe HTML so user input can't inject markup
function escapeHtml(text) {
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Shows a short message at the bottom of the screen
function showToast(message) {
  var toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("on");
  setTimeout(function () {
    toast.classList.remove("on");
  }, 2400);
}

// ---------- Contact links ----------

// Country code (no "+") added to numbers that start with 0, e.g. 0803... becomes 234803...
// 234 = Nigeria. Change this to your country's code if needed.
var DEFAULT_COUNTRY_CODE = "234";

var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value) {
  return EMAIL_PATTERN.test(value.trim());
}

// Turns whatever the person typed into digits only, in international format
// (no +, no spaces). Returns "" if it doesn't look like a phone number.
function toInternationalNumber(value) {
  var text = value.trim();
  var digits = text.replace(/\D/g, "");

  if (text.charAt(0) === "+") {
    // Already has a country code, e.g. +234 803 000 0000
  } else if (digits.indexOf("00") === 0) {
    // 00234... style
    digits = digits.slice(2);
  } else if (digits.charAt(0) === "0") {
    // Local style, e.g. 0803... so swap the leading 0 for the country code
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  }

  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function isValidContact(value) {
  return isEmail(value) || toInternationalNumber(value) !== "";
}

// Builds the buttons that open WhatsApp, a phone call, or an email draft
function renderContactActions(post) {
  var firstName = post.name.split(" ")[0];
  var contact = post.contact.trim();

  var intro = post.type === "offer"
    ? "Hi " + firstName + ", I saw your listing \"" + post.title + "\" on CampusLink and I'm interested."
    : "Hi " + firstName + ", I saw your request \"" + post.title + "\" on CampusLink and I can help.";

  // Email address: open an email draft addressed to that person
  if (isEmail(contact)) {
    var mailto =
      "mailto:" + contact +
      "?subject=" + encodeURIComponent("CampusLink: " + post.title) +
      "&body=" + encodeURIComponent(intro);

    return '<a class="btn" href="' + escapeHtml(mailto) + '">Email ' + escapeHtml(firstName) + "</a>";
  }

  // Phone number: WhatsApp chat or a normal phone call
  var number = toInternationalNumber(contact);

  if (number) {
    var whatsapp = "https://wa.me/" + number + "?text=" + encodeURIComponent(intro);

    return (
      '<a class="btn wa" href="' + escapeHtml(whatsapp) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="btn" href="tel:+' + number + '">Call</a>'
    );
  }

  // Anything else (older or unusual entries): just show the text
  return '<span class="contact-text">' + escapeHtml(contact) + "</span>";
}

// ---------- Rendering ----------

function renderChips() {
  var html = ["All"].concat(CATEGORIES).map(function (category) {
    return (
      '<button class="chip" data-cat="' + escapeHtml(category) + '" ' +
      'aria-pressed="' + (filters.cat === category) + '">' +
      escapeHtml(category) +
      "</button>"
    );
  }).join("");

  $("#chips").innerHTML = html;
}

// Builds the "❤ 12" like button and the reviews <details> block for one listing
function renderEngagement(post) {
  var entry = engagementStore[post.id];
  var liked = !!(entry && entry.likedByMe);
  var likeCount = getLikeCount(post.id);
  var reviews = getReviews(post.id);
  var average = getAverageRating(post.id);

  var ratingSummary = reviews.length
    ? '<span class="rating">' + renderStars(average) + " (" + reviews.length + ")</span>"
    : '<span class="rating muted">No reviews yet</span>';

  var reviewList = reviews.length
    ? reviews.map(function (review) {
        return (
          '<li class="review">' +
            "<b>" + escapeHtml(review.name) + "</b> " +
            '<span class="stars">' + renderStars(review.rating) + "</span>" +
            "<p>" + escapeHtml(review.text) + "</p>" +
          "</li>"
        );
      }).join("")
    : '<p class="muted">Be the first to leave a review.</p>';

  return (
    '<div class="engage">' +
      '<button class="like-btn" data-like="' + post.id + '" aria-pressed="' + liked + '">' +
        '<span aria-hidden="true">' + (liked ? "♥" : "♡") + "</span> " + likeCount +
      "</button>" +
      ratingSummary +
    "</div>" +
    "<details class=\"reviews\">" +
      "<summary>Reviews</summary>" +
      '<ul class="review-list">' + reviewList + "</ul>" +
      '<form class="review-form" data-review="' + post.id + '">' +
        '<div class="row">' +
          '<input name="name" required maxlength="30" placeholder="Your name">' +
          '<select name="rating" required>' +
            '<option value="">Rating</option>' +
            '<option value="5">★★★★★ Excellent</option>' +
            '<option value="4">★★★★☆ Good</option>' +
            '<option value="3">★★★☆☆ Okay</option>' +
            '<option value="2">★★☆☆☆ Poor</option>' +
            '<option value="1">★☆☆☆☆ Bad</option>' +
          "</select>" +
        "</div>" +
        '<textarea name="text" required maxlength="160" rows="2" placeholder="How did it go?"></textarea>' +
        '<button type="submit" class="btn ghost small">Post review</button>' +
      "</form>" +
    "</details>"
  );
}

function renderCard(post) {
  var label = post.type === "offer" ? "Offering" : "Looking for";

  return (
    '<article class="card ' + post.type + '">' +
      '<span class="tag">' + label + " · " + escapeHtml(post.cat) + "</span>" +
      "<h3>" + escapeHtml(post.title) + "</h3>" +
      "<p>" + escapeHtml(post.desc) + "</p>" +
      '<div class="meta">' +
        "<span>" + escapeHtml(post.name) + ", " + escapeHtml(post.uni) + "</span>" +
        "<b>" + escapeHtml(post.price) + "</b>" +
      "</div>" +
      '<div class="actions">' + renderContactActions(post) + "</div>" +
      renderEngagement(post) +
    "</article>"
  );
}

function renderBoard() {
  var query = filters.q.toLowerCase();
  var allPosts = posts.concat(SEED); // your posts appear first

  var visible = allPosts.filter(function (post) {
    var matchesType = filters.type === "all" || post.type === filters.type;
    var matchesCategory = filters.cat === "All" || post.cat === filters.cat;
    var searchable = (post.title + " " + post.desc + " " + post.cat + " " + post.name).toLowerCase();
    var matchesSearch = !query || searchable.indexOf(query) > -1;

    return matchesType && matchesCategory && matchesSearch;
  });

  if (visible.length) {
    $("#grid").innerHTML = visible.map(renderCard).join("");
  } else {
    $("#grid").innerHTML =
      '<div class="empty">Nothing matches yet. Clear the filters, or post this one yourself.</div>';
  }
}

// ---------- Events ----------

// One click handler for all buttons on the page
document.addEventListener("click", function (event) {
  var button = event.target.closest("button");
  if (!button) return;

  // "All / Offers / Requests" toggle
  if (button.dataset.type) {
    filters.type = button.dataset.type;
    document.querySelectorAll(".seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b === button);
    });
    renderBoard();

  // Category chip
  } else if (button.dataset.cat) {
    filters.cat = button.dataset.cat;
    renderChips();
    renderBoard();

  // Any "Post" / "Offer a service" / "I need something" button
  } else if (button.dataset.post) {
    var isOffer = button.dataset.post === "offer";
    $("#ft").value = button.dataset.post;
    $("#dt").textContent = isOffer ? "Offer a service" : "Request a service";
    $("#dlg").showModal();

  // Like button on a card
  } else if (button.dataset.like) {
    var entry = getEntry(button.dataset.like);
    entry.likedByMe = !entry.likedByMe;
    saveEngagement();
    renderBoard();
  }
});

// Posting a review (delegated, since review forms are created dynamically)
document.addEventListener("submit", function (event) {
  var form = event.target;
  if (!form.matches || !form.matches(".review-form")) return;

  event.preventDefault();
  var data = Object.fromEntries(new FormData(form).entries());
  if (!data.name.trim() || !data.rating || !data.text.trim()) return;

  var entry = getEntry(form.dataset.review);
  entry.reviews.push({
    name: data.name.trim(),
    rating: Number(data.rating),
    text: data.text.trim()
  });

  saveEngagement();
  renderBoard();
  showToast("Review posted");
});

// Live search
$("#q").addEventListener("input", function (event) {
  filters.q = event.target.value;
  renderBoard();
});

// Close the dialog
$("#cancel").addEventListener("click", function () {
  $("#dlg").close();
});

// Publish a new listing
$("#f").addEventListener("submit", function (event) {
  event.preventDefault();

  var listing = Object.fromEntries(new FormData(event.target).entries());
  listing.id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // The contact must be an email address or a phone number, so the links work
  if (!isValidContact(listing.contact)) {
    showToast("Enter a valid phone number or email address");
    return;
  }

  posts.unshift(listing);

  // Keep the 30 most recent posts in this browser
  try {
    localStorage.setItem("cl_posts", JSON.stringify(posts.slice(0, 30)));
  } catch (e) {
    // Storage may be blocked; the listing still shows for this visit
  }

  $("#dlg").close();
  event.target.reset();

  // Reset filters so the new listing is visible
  filters = { type: "all", cat: "All", q: "" };
  $("#q").value = "";
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.setAttribute("aria-pressed", b.dataset.type === "all");
  });

  renderChips();
  renderBoard();
  showToast("Listing published");
  location.hash = "#board";
});

// ---------- Start ----------

// Fill the category dropdown in the post form
$("#fc").innerHTML = CATEGORIES.map(function (category) {
  return "<option>" + escapeHtml(category) + "</option>";
}).join("");

renderChips();
renderBoard();
