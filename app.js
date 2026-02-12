document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("fileInput");
  const preview = document.getElementById("preview");

  if (!input || !preview) {
    alert("表示エリアが見つかりません");
    return;
  }

  input.addEventListener("change", () => {
    preview.innerHTML = "";

    Array.from(input.files).forEach(file => {
      if (!file.type.startsWith("image/")) return;

      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.style.maxWidth = "100%";
      img.style.marginBottom = "12px";
      img.style.borderRadius = "8px";

      preview.appendChild(img);
    });
  });
});
