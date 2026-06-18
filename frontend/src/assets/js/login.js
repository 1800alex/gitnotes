/* Login page controller. */
(function () {
  "use strict";
  const { Auth, Api } = window.NotesApp;

  // Already signed in? Skip straight to the app.
  Auth.redirectIfAuthenticated();

  const form = document.querySelector("[data-login-form]");
  const errorEl = form.querySelector("[data-error]");
  const submitBtn = form.querySelector("[data-submit]");

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) return;

    submitBtn.disabled = true;
    submitBtn.classList.add("is-loading");
    try {
      const res = await Api.login(username, password);
      Auth.save(res.token, res.username);
      window.location.replace("/");
    } catch (err) {
      showError(err.message || "Sign in failed");
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-loading");
    }
  });
})();
