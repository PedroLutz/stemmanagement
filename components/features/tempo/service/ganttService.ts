import { jsDateToEuDate } from "../../../../functions/general";
import { DepsData, PlanData, RealData } from "../../../ui/GanttChart/GanttChart";
import { GanttResType } from "../data/useTempoData";

const labelsSituacao = {
    start: 'Starting',
    executing: 'Executing',
    complete: 'Complete',
};

export const validateTaskStart = (gantt: GanttResType, allGantts: GanttResType[]): { isValid: boolean, message: string | null } => {
    if (gantt.gantt_data[1].status !== "start") {
        return { isValid: false, message: "This task has already been started!" };
    }

    for (const p of gantt.gantt_dependency) {
        const predecessor = allGantts.find(g => g.id === p.dependency_id);
        if (!predecessor) continue;

        const predecessorActual = predecessor.gantt_data[1];
        if (predecessorActual.status !== "complete") {
            return {
                isValid: false, message: `One of this task's predecessors is not completed yet!\n
                Predecessor: ${predecessor.wbs_item.wbs_area.name} - ${predecessor.wbs_item.name}.
                Status: ${labelsSituacao[predecessorActual.status]}.`
            };
        }

        const endDate = predecessorActual.end ? new Date(predecessorActual.end) : null;
        if (endDate && endDate > new Date()) {
            return {
                isValid: false, message: `One of this task's predecessors ends after today!\n
                Predecessor: ${predecessor.wbs_item.wbs_area.name} - ${predecessor.wbs_item.name}.
                Ending date: ${jsDateToEuDate(endDate)}.`
            };
        }
    }
    return { isValid: true, message: null };
};

export const validateTaskExecute = (gantt: GanttResType): { isValid: boolean, message: string | null } => {
    if (gantt.gantt_data[1].status !== "executing") {
        return { isValid: false, message: "This task must be started before checking execution!" };
    }

    if (new Date(gantt.gantt_data[1].start) > new Date()) {
        return { isValid: false, message: "This task starts after today!" };
    }

    return { isValid: true, message: null };
}

export const validateTaskComplete = (gantt: GanttResType): { isValid: boolean, message: string | null } => {
    if (gantt.gantt_data[1].status !== "executing") {
        return { isValid: false, message: "You can only complete a task while it is being executed!" };
    }

    if (new Date(gantt.gantt_data[1].start) > new Date()) {
        return { isValid: false, message: "This task starts after today!" };
    }

    return { isValid: true, message: null };
}

export const validateSavePlan = (planData: PlanData, gantt: GanttResType, allGantts: GanttResType[], newDeps: DepsData): { isValid: boolean, message: string | null } => {
    if (!planData.start && !planData.end) {
        return { isValid: true, message: null };
    }

    if (!planData.start || !planData.end || new Date(planData.start) > new Date(planData.end)) {
        return { isValid: false, message: "Invalid starting/ending dates for the planned task!" };
    }

    const allDependencies = [...gantt.gantt_dependency.map(g => g.dependency_id), ...newDeps.dependencies];

    for (const p of allDependencies) {
        const predecessor = allGantts.find(g => g.id === p);
        if (!predecessor) continue;

        const predecessorPlan = predecessor.gantt_data[0];

        const endDate = predecessorPlan.end ? new Date(predecessorPlan.end) : null;
        if (endDate) {
            if (endDate > new Date(planData.start)) {
                return {
                    isValid: false, message: `One of this task's predecessors is planned to end after the new starting date!\n
                    Predecessor: ${predecessor.wbs_item.wbs_area.name} - ${predecessor.wbs_item.name}.
                    Planned end: ${jsDateToEuDate(endDate)}.`
                };
            }
        } else {
            return { isValid: false, 
                message: `One of this task's predecessors does not have planned dates!\n\n
                Predecessor: ${predecessor.wbs_item.wbs_area.name} - ${predecessor.wbs_item.name}.`
            }
        }
    }

    const successors = allGantts.filter(g => {
        for (const d of g.gantt_dependency) {
            if (d.dependency_id === gantt.id) return true;
        }
        return false;
    })

    for (const s of successors) {
        const successorPlan = s.gantt_data[0];

        const startDate = successorPlan.start ? new Date(successorPlan.start) : null;

        if (startDate && startDate < new Date(planData.end)) {
            return {
                isValid: false, message: `One of this task's successors is planned to start before the new ending date!\n
                Successor: ${s.wbs_item.wbs_area.name} - ${s.wbs_item.name}.
                Planned start: ${jsDateToEuDate(s.gantt_data[0].start)}.`
            };
        }
    }

    return { isValid: true, message: null };
}

export const validateSaveActual = (realData: RealData, gantt: GanttResType, allGantts: GanttResType[], newDeps: DepsData): { isValid: boolean, message: string | null } => {
    if (!realData.start && !realData.end && realData.status === "start") {
        return { isValid: true, message: null };
    }

    if (!realData.start || !realData.end || new Date(realData.start) > new Date(realData.end)) {
        return { isValid: false, message: "Invalid starting/ending dates for the actual task!" };
    }

    const allDependencies = [...gantt.gantt_dependency.map(g => g.dependency_id), ...newDeps.dependencies];

    for (const p of allDependencies) {
        const predecessor = allGantts.find(g => g.id === p);
        if (!predecessor) continue;

        const predecessorActual = predecessor.gantt_data[1];

        const endDate = predecessorActual.end ? new Date(predecessorActual.end) : null;
        if (endDate) {
            if (endDate > new Date(realData.start)) {
                return {
                    isValid: false, message: `One of this task's predecessors ends after the new starting date!\n
                    Predecessor: ${predecessor.wbs_item.wbs_area.name} - ${predecessor.wbs_item.name}.
                    End: ${jsDateToEuDate(endDate)}.`
                };
            }
        } else {
            return { isValid: false, 
                message: `One of this task's predecessors does not have actual dates!\n\n
                Predecessor: ${predecessor.wbs_item.wbs_area.name} - ${predecessor.wbs_item.name}.`
            }
        }

        if (predecessorActual.status !== "complete" && realData.status !== "start") {
            return {
                isValid: false, message: `You cannot set the status to ${realData.status} because one of this tasks predecessors is not completed!\n
            Predecessor: ${predecessor.wbs_item.wbs_area.name} - ${predecessor.wbs_item.name}.
            Status: ${labelsSituacao[predecessorActual.status]}`
            };
        }
    }

    const successors = allGantts.filter(g => {
        for (const d of g.gantt_dependency) {
            if (d.dependency_id === gantt.id) return true;
        }
        return false;
    })

    for (const s of successors) {
        if (s.gantt_data[1].start != null && new Date(s.gantt_data[1].start) < new Date(realData.id)) {
            return {
                isValid: false, message: `One of this task's successors starts before the new ending date!\n
                Successor: ${s.wbs_item.wbs_area.name} - ${s.wbs_item.name}.
                Start: ${jsDateToEuDate(s.gantt_data[1].start)}.`
            };
        }

        if (s.gantt_data[1].status !== "start" && realData.status !== "complete") {
            return {
                isValid: false, message: `You cannot set the status to ${realData.status} because one of this tasks successors already started execution!\n
                Successor: ${s.wbs_item.wbs_area.name} - ${s.wbs_item.name}.
                Status: ${labelsSituacao[s.gantt_data[1].status]}.`
            }
        }
    }

    return { isValid: true, message: null };
}

export const calculateDependencyChanges = (
    existingDeps: (number | string)[],
    newDeps: (number | string)[]
): { toDelete: (number | string)[]; toCreate: (number | string)[] } => {
    const toDelete = existingDeps.filter(dep => !newDeps.includes(dep));

    const toCreate = newDeps.filter(dep => !existingDeps.includes(dep));

    return { toDelete, toCreate };
};