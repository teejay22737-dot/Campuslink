/* CampusLink – board logic (Supabase-backed)
   Listings, likes and reviews live in a shared Supabase database, so every
   visitor sees the same data on every device. Set your project keys in
   config.js and create the tables using schema.sql before this will work. */

// ---------- Supabase client ----------

var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Catches anything that goes wrong outside the explicit error checks below,
// so a problem always surfaces instead of failing silently.
window.addEventListener("unhandledrejection", function (event) {
  console.error("CampusLink unexpected error:", event.reason);
});

// ---------- Static data ----------

var CATEGORIES = [
  "Tutoring",
  "Design & Tech",
  "Writing & Typing",
  "Beauty & Fashion",
  "Food & Delivery",
  "Repairs",
  "Errands"
];

// ---------- State ----------

// Current filters chosen by the visitor
var filters = { type: "all", cat: "All", q: "" };

// Id of the listing currently being edited in the dialog, or null when posting a new one
var editingId = null;

// The signed-in visitor, or null when signed out (set by onAuthStateChange below)
var currentUser = null;

// Data loaded from Supabase
var listings = [];          // rows from the "listings" table
var likesByListing = {};    // { listingId: [ user_id, user_id, ... ] }
var reviewsByListing = {};  // { listingId: [ { id, name, rating, text, user_id }, ... ] }
var commentsByListing = {}; // { listingId: [ { id, parent_id, name, text, user_id }, ... ] }
var profilesById = {};      // { userId: { id, name, uni, bio, avatar } }

// Which profile page is currently open (from the "#/profile/<id>" URL), or null on the home view
var viewingProfileId = null;

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

// ---------- Auth ----------

function updateAuthUI() {
  var btn = $("#authBtn");
  var myProfileBtn = $("#myProfileBtn");
  var navAvatar = $("#navAvatar");

  if (currentUser) {
    var profile = profilesById[currentUser.id];
    var name = (profile && profile.name) || currentUser.email.split("@")[0];
    navAvatar.src = (profile && profile.avatar) || avatarPlaceholder(name);
    navAvatar.alt = name;
    myProfileBtn.classList.remove("is-hidden");
    btn.textContent = "Sign out";
  } else {
    myProfileBtn.classList.add("is-hidden");
    btn.textContent = "Sign in";
  }
}

// Makes sure a signed-in visitor has a profiles row, creating a default one the first time
async function ensureProfile() {
  if (!currentUser) return;
  if (profilesById[currentUser.id]) return;

  var defaultName = currentUser.email.split("@")[0];
  var result = await supabase.from("profiles").insert({
    id: currentUser.id,
    name: defaultName
  }).select();

  if (!result.error && result.data && result.data[0]) {
    profilesById[currentUser.id] = result.data[0];
  }
}

supabase.auth.onAuthStateChange(async function (event, session) {
  currentUser = session ? session.user : null;
  updateAuthUI();
  if (currentUser) await ensureProfile();
  renderBoard();
  if (viewingProfileId) renderProfileView();
});

$("#authBtn").addEventListener("click", async function () {
  if (currentUser) {
    if (confirm("Sign out?")) {
      await supabase.auth.signOut();
      showToast("Signed out");
    }
  } else {
    $("#authMsg").textContent = "";
    $("#authDlg").showModal();
  }
});

$("#authCancel").addEventListener("click", function () {
  $("#authDlg").close();
});

$("#authForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  var email = $("#authEmail").value.trim();
  var password = $("#authPassword").value;

  $("#authMsg").textContent = "Signing in...";
  var result = await supabase.auth.signInWithPassword({ email: email, password: password });

  if (result.error) {
    $("#authMsg").textContent = result.error.message;
    return;
  }

  $("#authDlg").close();
  $("#authForm").reset();
  showToast("Signed in");
});

$("#authSignUp").addEventListener("click", async function () {
  var email = $("#authEmail").value.trim();
  var password = $("#authPassword").value;

  if (!email || password.length < 6) {
    $("#authMsg").textContent = "Enter an email and a password of at least 6 characters.";
    return;
  }

  $("#authMsg").textContent = "Creating account...";
  var result = await supabase.auth.signUp({ email: email, password: password });

  if (result.error) {
    $("#authMsg").textContent = result.error.message;
    return;
  }

  // Depending on your Supabase project's auth settings, the visitor may need
  // to confirm their email before signInWithPassword will work for them.
  $("#authMsg").textContent = "Account created. Check your email to confirm it, then sign in.";
});

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

// ---------- Loading data from Supabase ----------

async function loadListings() {
  var result = await supabase.from("listings").select("*").order("created_at", { ascending: false });
  if (result.error) {
    showToast("Couldn't load listings");
    return;
  }
  listings = result.data;
}

async function loadLikes() {
  var result = await supabase.from("likes").select("listing_id,user_id");
  if (result.error) return;

  likesByListing = {};
  result.data.forEach(function (row) {
    if (!likesByListing[row.listing_id]) likesByListing[row.listing_id] = [];
    likesByListing[row.listing_id].push(row.user_id);
  });
}

async function loadReviews() {
  var result = await supabase.from("reviews").select("*").order("created_at", { ascending: true });
  if (result.error) return;

  reviewsByListing = {};
  result.data.forEach(function (row) {
    if (!reviewsByListing[row.listing_id]) reviewsByListing[row.listing_id] = [];
    reviewsByListing[row.listing_id].push(row);
  });
}

async function loadComments() {
  var result = await supabase.from("comments").select("*").order("created_at", { ascending: true });
  if (result.error) return;

  commentsByListing = {};
  result.data.forEach(function (row) {
    if (!commentsByListing[row.listing_id]) commentsByListing[row.listing_id] = [];
    commentsByListing[row.listing_id].push(row);
  });
}

async function loadProfiles() {
  var result = await supabase.from("profiles").select("*");
  if (result.error) return;

  profilesById = {};
  result.data.forEach(function (row) {
    profilesById[row.id] = row;
  });
}

async function loadAll() {
  await Promise.all([loadListings(), loadLikes(), loadReviews(), loadComments(), loadProfiles()]);
  if (currentUser) await ensureProfile();
  updateAuthUI();
  renderChips();
  renderBoard();
  if (viewingProfileId) renderProfileView();
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

function renderStars(rating) {
  var rounded = Math.round(rating);
  var stars = "";
  for (var i = 1; i <= 5; i++) {
    stars += i <= rounded ? "★" : "☆";
  }
  return stars;
}

// Builds the "❤ 12" like button and the reviews <details> block for one listing
function renderEngagement(post) {
  var likeIds = likesByListing[post.id] || [];
  var liked = !!(currentUser && likeIds.indexOf(currentUser.id) > -1);
  var reviews = reviewsByListing[post.id] || [];
  var average = reviews.length
    ? reviews.reduce(function (sum, r) { return sum + r.rating; }, 0) / reviews.length
    : 0;

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

  var reviewForm = currentUser
    ? (
        '<form class="review-form" data-review="' + post.id + '">' +
          '<div class="row">' +
            '<input name="name" required maxlength="30" placeholder="Your name" value="' +
              escapeHtml(currentUser.email.split("@")[0]) + '">' +
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
        "</form>"
      )
    : '<p class="muted">Sign in to leave a review.</p>';

  return (
    '<div class="engage">' +
      '<button class="like-btn" data-like="' + post.id + '" aria-pressed="' + liked + '">' +
        '<span aria-hidden="true">' + (liked ? "♥" : "♡") + "</span> " + likeIds.length +
      "</button>" +
      ratingSummary +
    "</div>" +
    "<details class=\"reviews\">" +
      "<summary>Reviews</summary>" +
      '<ul class="review-list">' + reviewList + "</ul>" +
      reviewForm +
    "</details>"
  );
}

// True when the signed-in visitor posted this listing
function isOwnPost(post) {
  return !!(currentUser && post.owner === currentUser.id);
}

// Builds the "Comments" block: top-level comments, one level of replies under each, and the forms to add more
function renderComments(post) {
  var all = commentsByListing[post.id] || [];
  var topLevel = all.filter(function (c) { return !c.parent_id; });

  var commentName = currentUser
    ? escapeHtml((profilesById[currentUser.id] && profilesById[currentUser.id].name) || currentUser.email.split("@")[0])
    : "";

  function renderReplies(commentId) {
    var replies = all.filter(function (c) { return c.parent_id === commentId; });
    if (!replies.length) return "";

    return '<ul class="reply-list">' + replies.map(function (reply) {
      return (
        '<li class="reply">' +
          "<b>" + escapeHtml(reply.name) + "</b> " +
          "<span>" + escapeHtml(reply.text) + "</span>" +
        "</li>"
      );
    }).join("") + "</ul>";
  }

  var commentList = topLevel.length
    ? topLevel.map(function (comment) {
        var replyCount = all.filter(function (c) { return c.parent_id === comment.id; }).length;
        var replyForm = currentUser
          ? (
              '<form class="reply-form" data-listing="' + post.id + '" data-parent="' + comment.id + '">' +
                '<input name="name" required maxlength="30" placeholder="Your name" value="' + commentName + '">' +
                '<input name="text" required maxlength="160" placeholder="Write a reply...">' +
                '<button type="submit" class="btn ghost small">Reply</button>' +
              "</form>"
            )
          : "";

        return (
          '<li class="comment">' +
            '<div class="comment-head"><b>' + escapeHtml(comment.name) + "</b></div>" +
            "<p>" + escapeHtml(comment.text) + "</p>" +
            "<details class=\"replies\">" +
              "<summary>" + (replyCount ? replyCount + (replyCount === 1 ? " reply" : " replies") + " · " : "") + "Reply</summary>" +
              renderReplies(comment.id) +
              replyForm +
            "</details>" +
          "</li>"
        );
      }).join("")
    : '<li class="muted">No comments yet.</li>';

  var commentForm = currentUser
    ? (
        '<form class="comment-form" data-listing="' + post.id + '">' +
          '<input name="name" required maxlength="30" placeholder="Your name" value="' + commentName + '">' +
          '<input name="text" required maxlength="160" placeholder="Write a comment...">' +
          '<button type="submit" class="btn ghost small">Comment</button>' +
        "</form>"
      )
    : '<p class="muted">Sign in to leave a comment.</p>';

  return (
    "<details class=\"comments-block\">" +
      "<summary>" + (topLevel.length ? topLevel.length + " comments" : "Comments") + "</summary>" +
      '<ul class="comment-list">' + commentList + "</ul>" +
      commentForm +
    "</details>"
  );
}

function renderOwnerActions(post) {
  if (!isOwnPost(post)) return "";

  return (
    '<div class="owner-actions">' +
      '<button type="button" class="btn ghost small" data-edit="' + post.id + '">Edit</button>' +
      '<button type="button" class="btn ghost small danger" data-delete="' + post.id + '">Delete</button>' +
    "</div>"
  );
}

function renderCard(post) {
  var label = post.type === "offer" ? "Offering" : "Looking for";
  var profileBtn =
    '<button type="button" class="profile-link" data-profile="' + post.owner + '">' +
      escapeHtml(post.name) +
    "</button>";

  var photo = post.image
    ? '<img class="listing-image" src="' + post.image + '" alt="">'
    : "";

  return (
    '<article class="card ' + post.type + '">' +
      photo +
      '<span class="tag">' + label + " · " + escapeHtml(post.cat) + "</span>" +
      "<h3>" + escapeHtml(post.title) + "</h3>" +
      "<p>" + escapeHtml(post.description) + "</p>" +
      '<div class="meta">' +
        "<span>" + profileBtn + ", " + escapeHtml(post.uni) + "</span>" +
        "<b>" + escapeHtml(post.price) + "</b>" +
      "</div>" +
      '<div class="actions">' + renderContactActions(post) + "</div>" +
      renderOwnerActions(post) +
      renderEngagement(post) +
      renderComments(post) +
    "</article>"
  );
}

function renderBoard() {
  var query = filters.q.toLowerCase();

  var visible = listings.filter(function (post) {
    var matchesType = filters.type === "all" || post.type === filters.type;
    var matchesCategory = filters.cat === "All" || post.cat === filters.cat;
    var searchable = (post.title + " " + post.description + " " + post.cat + " " + post.name).toLowerCase();
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

// Fills in the profile page for whichever user id is currently open
function renderProfileView() {
  var profile = profilesById[viewingProfileId] || { name: "Unknown student", uni: "", bio: "", avatar: "" };
  var isMine = !!(currentUser && currentUser.id === viewingProfileId);

  $("#profileAvatar").src = profile.avatar || avatarPlaceholder(profile.name);
  $("#profileName").textContent = profile.name || "Unknown student";
  $("#profileUni").textContent = profile.uni || "";
  $("#profileBio").textContent = profile.bio || (isMine ? "Add a short bio about what you offer or study." : "");
  $("#editProfileBtn").classList.toggle("is-hidden", !isMine);

  var ownPosts = listings.filter(function (post) {
    return post.owner === viewingProfileId;
  });

  $("#profileGrid").innerHTML = ownPosts.length
    ? ownPosts.map(renderCard).join("")
    : '<div class="empty">' + (isMine ? "You haven't posted anything yet." : "No posts yet.") + "</div>";
}

// A simple circular placeholder avatar (first letter of the name) as a data URL,
// used until someone uploads a real profile picture.
function avatarPlaceholder(name) {
  var letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" rx="40" fill="#2F5BFF"/>' +
      '<text x="40" y="52" font-size="34" font-family="sans-serif" fill="#fff" text-anchor="middle">' + letter + "</text>" +
    "</svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// ---------- Routing between the home board and a profile page ----------

function showHome() {
  viewingProfileId = null;
  $("#viewHome").classList.remove("is-hidden");
  $("#viewProfile").classList.add("is-hidden");
}

function showProfile(userId) {
  viewingProfileId = userId;
  $("#viewHome").classList.add("is-hidden");
  $("#viewProfile").classList.remove("is-hidden");
  renderProfileView();
  window.scrollTo(0, 0);
}

function route() {
  var match = location.hash.match(/^#\/profile\/(.+)$/);
  if (match) {
    showProfile(decodeURIComponent(match[1]));
  } else {
    showHome();
  }
}

window.addEventListener("hashchange", route);

// ---------- Events ----------

// One click handler for all buttons on the page
document.addEventListener("click", async function (event) {
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
    if (!currentUser) {
      showToast("Sign in to post a listing");
      $("#authDlg").showModal();
      return;
    }
    var isOffer = button.dataset.post === "offer";
    editingId = null;
    $("#f").reset();
    $("#ft").value = button.dataset.post;
    $("#dt").textContent = isOffer ? "Offer a service" : "Request a service";
    $("#submitBtn").textContent = "Publish listing";
    $("#listingImageValue").value = "";
    $("#listingImagePreview").classList.add("is-hidden");
    $("#dlg").showModal();

  // Edit button on a card you own
  } else if (button.dataset.edit) {
    var listing = listings.find(function (post) {
      return post.id === button.dataset.edit;
    });
    if (!listing || !isOwnPost(listing)) return;

    editingId = listing.id;
    $("#ft").value = listing.type;
    $("#f").title.value = listing.title;
    $("#fc").value = listing.cat;
    $("#f").description.value = listing.description;
    $("#f").name.value = listing.name;
    $("#f").uni.value = listing.uni;
    $("#f").price.value = listing.price;
    $("#f").contact.value = listing.contact;
    $("#listingImageValue").value = listing.image || "";
    var editPreview = $("#listingImagePreview");
    if (listing.image) {
      editPreview.src = listing.image;
      editPreview.classList.remove("is-hidden");
    } else {
      editPreview.classList.add("is-hidden");
    }
    $("#dt").textContent = "Edit listing";
    $("#submitBtn").textContent = "Save changes";
    $("#dlg").showModal();

  // Delete button on a card you own
  } else if (button.dataset.delete) {
    var toDelete = listings.find(function (post) {
      return post.id === button.dataset.delete;
    });
    if (!toDelete || !isOwnPost(toDelete)) return;
    if (!confirm("Delete this listing? This can't be undone.")) return;

    var deleteResult = await supabase.from("listings").delete().eq("id", toDelete.id);
    if (deleteResult.error) {
      console.error("CampusLink delete error:", deleteResult.error);
    showToast("Couldn't delete: " + deleteResult.error.message);
      return;
    }
    await loadAll();
    showToast("Listing deleted");

  // Like button on a card
  } else if (button.dataset.like) {
    if (!currentUser) {
      showToast("Sign in to like a listing");
      $("#authDlg").showModal();
      return;
    }
    var id = button.dataset.like;
    var likeIds = likesByListing[id] || [];
    var alreadyLiked = likeIds.indexOf(currentUser.id) > -1;

    if (alreadyLiked) {
      await supabase.from("likes").delete().eq("listing_id", id).eq("user_id", currentUser.id);
    } else {
      await supabase.from("likes").insert({ listing_id: id, user_id: currentUser.id });
    }
    await loadLikes();
    renderBoard();
    if (viewingProfileId) renderProfileView();

  // A poster's name: open their profile page
  } else if (button.dataset.profile) {
    location.hash = "#/profile/" + encodeURIComponent(button.dataset.profile);

  // "My profile" button in the header
  } else if (button.id === "myProfileBtn") {
    if (currentUser) location.hash = "#/profile/" + encodeURIComponent(currentUser.id);

  // "Edit profile" button on your own profile page
  } else if (button.id === "editProfileBtn") {
    var myProfile = profilesById[currentUser.id] || {};
    $("#profileNameInput").value = myProfile.name || "";
    $("#profileUniInput").value = myProfile.uni || "";
    $("#profileBioInput").value = myProfile.bio || "";
    var preview = $("#avatarPreview");
    if (myProfile.avatar) {
      preview.src = myProfile.avatar;
      preview.classList.remove("is-hidden");
    } else {
      preview.classList.add("is-hidden");
    }
    $("#avatarInput").value = "";
    $("#profileDlg").showModal();

  // Cancel the profile-edit dialog
  } else if (button.id === "profileCancel") {
    $("#profileDlg").close();
  }
});

// Live search
$("#q").addEventListener("input", function (event) {
  filters.q = event.target.value;
  renderBoard();
});

// Close the post dialog
$("#cancel").addEventListener("click", function () {
  editingId = null;
  $("#dlg").close();
});

// Preview a chosen profile picture, and keep it small enough to store as a data URL
$("#avatarInput").addEventListener("change", function (event) {
  var file = event.target.files[0];
  if (!file) return;

  if (file.size > 600 * 1024) {
    showToast("Please choose an image under 600KB");
    event.target.value = "";
    return;
  }

  var reader = new FileReader();
  reader.onload = function () {
    var preview = $("#avatarPreview");
    preview.src = reader.result;
    preview.classList.remove("is-hidden");
  };
  reader.readAsDataURL(file);
});

// Shrinks an uploaded image down to a reasonable size and returns it as a data URL,
// so listing photos don't bloat the database or take forever to load.
function resizeImageFile(file, maxDimension, quality) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = reject;
    reader.onload = function () {
      var img = new Image();
      img.onerror = reject;
      img.onload = function () {
        var scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Preview and compress a chosen listing photo
$("#listingImageInput").addEventListener("change", async function (event) {
  var file = event.target.files[0];
  if (!file) return;

  var dataUrl = await resizeImageFile(file, 1000, 0.7);

  // If it's still large (a very detailed photo), compress harder rather than reject it
  if (dataUrl.length > 900 * 1024) {
    dataUrl = await resizeImageFile(file, 700, 0.5);
  }

  $("#listingImageValue").value = dataUrl;
  var preview = $("#listingImagePreview");
  preview.src = dataUrl;
  preview.classList.remove("is-hidden");
});

// Save changes to your own profile
$("#profileForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  if (!currentUser) return;

  var preview = $("#avatarPreview");
  var avatar = preview.classList.contains("is-hidden")
    ? (profilesById[currentUser.id] && profilesById[currentUser.id].avatar) || ""
    : preview.src;

  var result = await supabase.from("profiles").update({
    name: $("#profileNameInput").value.trim(),
    uni: $("#profileUniInput").value.trim(),
    bio: $("#profileBioInput").value.trim(),
    avatar: avatar
  }).eq("id", currentUser.id);

  if (result.error) {
    console.error("CampusLink profile save error:", result.error);
    showToast("Couldn't save profile: " + result.error.message);
    return;
  }

  $("#profileDlg").close();
  await loadProfiles();
  updateAuthUI();
  renderBoard();
  if (viewingProfileId) renderProfileView();
  showToast("Profile updated");
});

// Posting a review (delegated, since review forms are created dynamically)
document.addEventListener("submit", async function (event) {
  var form = event.target;
  if (!form.matches || !form.matches(".review-form")) return;

  event.preventDefault();
  if (!currentUser) {
    showToast("Sign in to leave a review");
    $("#authDlg").showModal();
    return;
  }

  var data = Object.fromEntries(new FormData(form).entries());
  if (!data.name.trim() || !data.rating || !data.text.trim()) return;

  var result = await supabase.from("reviews").insert({
    listing_id: form.dataset.review,
    user_id: currentUser.id,
    name: data.name.trim(),
    rating: Number(data.rating),
    text: data.text.trim()
  });

  if (result.error) {
    console.error("CampusLink review error:", result.error);
    showToast("Couldn't post review: " + result.error.message);
    return;
  }

  await loadReviews();
  renderBoard();
  showToast("Review posted");
});

// Posting a top-level comment (delegated, since comment forms are created dynamically)
document.addEventListener("submit", async function (event) {
  var form = event.target;
  if (!form.matches || !form.matches(".comment-form")) return;

  event.preventDefault();
  if (!currentUser) {
    showToast("Sign in to leave a comment");
    $("#authDlg").showModal();
    return;
  }

  var data = Object.fromEntries(new FormData(form).entries());
  if (!data.name.trim() || !data.text.trim()) return;

  var result = await supabase.from("comments").insert({
    listing_id: form.dataset.listing,
    user_id: currentUser.id,
    name: data.name.trim(),
    text: data.text.trim()
  });

  if (result.error) {
    console.error("CampusLink comment error:", result.error);
    showToast("Couldn't post comment: " + result.error.message);
    return;
  }

  await loadComments();
  renderBoard();
  if (viewingProfileId) renderProfileView();
  showToast("Comment posted");
});

// Posting a reply to a comment (delegated, same reason as above)
document.addEventListener("submit", async function (event) {
  var form = event.target;
  if (!form.matches || !form.matches(".reply-form")) return;

  event.preventDefault();
  if (!currentUser) {
    showToast("Sign in to reply");
    $("#authDlg").showModal();
    return;
  }

  var data = Object.fromEntries(new FormData(form).entries());
  if (!data.name.trim() || !data.text.trim()) return;

  var result = await supabase.from("comments").insert({
    listing_id: form.dataset.listing,
    parent_id: form.dataset.parent,
    user_id: currentUser.id,
    name: data.name.trim(),
    text: data.text.trim()
  });

  if (result.error) {
    console.error("CampusLink reply error:", result.error);
    showToast("Couldn't post reply: " + result.error.message);
    return;
  }

  await loadComments();
  renderBoard();
  if (viewingProfileId) renderProfileView();
  showToast("Reply posted");
});

// Publish a new listing, or save changes to one of your own
$("#f").addEventListener("submit", async function (event) {
  event.preventDefault();

  if (!currentUser) {
    showToast("Sign in to post a listing");
    $("#dlg").close();
    $("#authDlg").showModal();
    return;
  }

  var listing = Object.fromEntries(new FormData(event.target).entries());

  // The contact must be an email address or a phone number, so the links work
  if (!isValidContact(listing.contact)) {
    showToast("Enter a valid phone number or email address");
    return;
  }

  var wasEditing = !!editingId;
  var result;

  if (editingId) {
    // Saving changes to an existing listing you own
    result = await supabase.from("listings").update({
      type: listing.type,
      cat: listing.cat,
      title: listing.title,
      description: listing.description,
      name: listing.name,
      uni: listing.uni,
      price: listing.price,
      contact: listing.contact,
      image: listing.image || ""
    }).eq("id", editingId);
  } else {
    // Publishing a brand new listing
    result = await supabase.from("listings").insert({
      type: listing.type,
      cat: listing.cat,
      title: listing.title,
      description: listing.description,
      name: listing.name,
      uni: listing.uni,
      price: listing.price,
      contact: listing.contact,
      image: listing.image || "",
      owner: currentUser.id
    });
  }

  if (result.error) {
    console.error("CampusLink listing save error:", result.error);
    showToast("Couldn't save: " + result.error.message);
    return;
  }

  editingId = null;
  $("#dlg").close();
  event.target.reset();

  // Reset filters so the listing is visible
  filters = { type: "all", cat: "All", q: "" };
  $("#q").value = "";
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.setAttribute("aria-pressed", b.dataset.type === "all");
  });

  renderChips();
  await loadListings();
  renderBoard();
  showToast(wasEditing ? "Listing updated" : "Listing published");
  location.hash = "#board";
});

// ---------- Realtime ----------
// Keeps every visitor's board in sync as other people post, edit, like or review.
// Requires realtime to be switched on for these tables — see schema.sql.

supabase
  .channel("public:listings")
  .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, function () {
    loadListings().then(function () {
      renderBoard();
      if (viewingProfileId) renderProfileView();
    });
  })
  .subscribe();

supabase
  .channel("public:likes")
  .on("postgres_changes", { event: "*", schema: "public", table: "likes" }, function () {
    loadLikes().then(renderBoard);
  })
  .subscribe();

supabase
  .channel("public:reviews")
  .on("postgres_changes", { event: "*", schema: "public", table: "reviews" }, function () {
    loadReviews().then(renderBoard);
  })
  .subscribe();

supabase
  .channel("public:comments")
  .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, function () {
    loadComments().then(renderBoard);
  })
  .subscribe();

supabase
  .channel("public:profiles")
  .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, function () {
    loadProfiles().then(function () {
      renderBoard();
      if (viewingProfileId) renderProfileView();
    });
  })
  .subscribe();

// ---------- Start ----------

// Fill the category dropdown in the post form
$("#fc").innerHTML = CATEGORIES.map(function (category) {
  return "<option>" + escapeHtml(category) + "</option>";
}).join("");

renderChips();
route();
loadAll();
