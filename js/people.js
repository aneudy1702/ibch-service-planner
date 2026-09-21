export function buildParticipationSummary(people, assignments, roleId) {
  const completed = assignments.filter((item) => item.roleId === roleId && item.status === "completed");

  return people
    .map((person) => {
      const completedByPerson = completed.filter((item) => item.personId === person.id);
      const lastService = completedByPerson
        .map((item) => item.serviceDate)
        .sort((a, b) => b.localeCompare(a))[0];
      return {
        personId: person.id,
        name: person.name,
        completedCount: completedByPerson.length,
        lastServiceDate: lastService || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getHomeStats(people, assignments, roleId) {
  const completedIds = new Set(
    assignments
      .filter((item) => item.roleId === roleId && item.status === "completed")
      .map((item) => item.personId),
  );

  const activePeople = people.filter((person) => person.active);
  return {
    totalPeople: people.length,
    activePeople: activePeople.length,
    participated: completedIds.size,
    waiting: activePeople.filter((person) => !completedIds.has(person.id)).length,
  };
}
