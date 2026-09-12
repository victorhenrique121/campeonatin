const isKnockoutSelected = (form: HTMLFormElement) =>
  form.querySelector(".format-toggle button.selected")?.textContent?.includes("Mata-mata") ?? false;

const getParticipantCount = () => {
  const text = document.querySelector(".selection-count")?.textContent ?? "";
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
};

const validateKnockoutParticipants = (form: HTMLFormElement) => {
  if (!isKnockoutSelected(form)) return true;

  const count = getParticipantCount();
  if (![2, 4, 8, 16, 32].includes(count)) {
    alert("O mata-mata exige 2, 4, 8, 16 ou 32 participantes.");
    return false;
  }

  return true;
};

const handleChampionshipSubmit = (event: SubmitEvent) => {
  const target = event.target;
  if (!(target instanceof HTMLFormElement)) return;
  if (!target.closest(".arena-create-card")) return;

  if (!validateKnockoutParticipants(target)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
};

document.addEventListener("submit", handleChampionshipSubmit, true);
