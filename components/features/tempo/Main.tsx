import { TempoProvider, useTempo } from "./data/TempoContext"
import Loading from "../../ui/Loading";
import { DepsData, GanttChart, PlanData, RealData } from "../../ui/GanttChart/GanttChart";
import { useCallback, useEffect, useState } from "react";
import { handleFetch, handlePostFetch, handleReq } from "../../../functions/crud_s";
import useAuth from "../../../hooks/useAuth";
import usePerm from '../../../hooks/usePerm';
import { useToolbar } from "../../../hooks/useToolbar";
import HelpBubble from "../../ui/HelpBubble/cronograma/TimeMonitoring";
import Modal from "../../ui/Modal"
import { calculateDependencyChanges, validateSaveActual, validateSavePlan, validateTaskComplete, validateTaskExecute, validateTaskStart } from "./service/ganttService";
import { GanttResType } from "./data/useTempoData";

type QuickUpdateActionType = "start" | "execute" | "complete";

type UpdateDataType = {
    id: number | string; 
    user_id: any;
    status?: string | null; 
    start?: string | null; 
    end?: string | null;
}

const Content = () => {
    const { setIsLoading, isLoading, chartData, refetchData, gantts } = useTempo();
    const {user, token} = useAuth();
    const { isEditor } = usePerm();

    const { setExportCSVClick, setHelpClick, setGeneratePreviewLink } = useToolbar();
    const [ showHelp, setShowHelp ] = useState(false);
    const [ modalText, setModalText ] = useState<string | null>(null);
    const [ confirmResetDatesOfId, setConfirmResetDatesOfId ] = useState<number | string | null>(null);

    const generatePreviewLink = async () => {
        setIsLoading(true);
        const data = await handleFetch({
            table: "profiles",
            query: "all",
            token,
        });

        setIsLoading(false);
        if(!data || !data.data[0].public_token) {
            return;
        };
        // navigator.clipboard.writeText(`http://localhost:6969/preview/gantt?token=${data.data[0].public_token}`)
        navigator.clipboard.writeText(`https://stemmanagement.vercel.app/preview/gantt?token=${data.data[0].public_token}`)
    }

    useEffect(() => {
            setHelpClick(() => () => setShowHelp(true));
            setGeneratePreviewLink(() => generatePreviewLink)
    
            return (() => {
                setHelpClick(null);
                setGeneratePreviewLink(null);
            })
        }, [token]);

    const handleOnQuickUpdate = useCallback( async (id: number | string, action: QuickUpdateActionType, 
        validate: (gantt: GanttResType) => { isValid: boolean, message: string | null }
    ) : Promise<boolean> => {
        setIsLoading(true);
        const gantt = gantts.find(g => g.gantt_data[1].id === id);
        
        if (!gantt) {
            setModalText("An unknown error has happened!");
            setIsLoading(false);
            return false;
        }

        const validation = validate(gantt);
        if (!validation.isValid) {
            setModalText(validation.message);
            setIsLoading(false);
            return false;
        }

        const today = new Date();
        const formattedDate = today
                .toLocaleString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
                .split(',')[0];
        const data : UpdateDataType = {
            id,
            user_id: user?.id
        };

        switch(action){
            case "start": {
                data.status = "executing";
                data.start = formattedDate;
                data.end = null;
                break;
            }
            case "execute": {
                data.end = formattedDate;
                break;
            }
            case "complete": {
                data.status = "complete";
                data.end = formattedDate;
                break;
            }
        }

        await handleReq({
            table: "gantt_data",
            route: "update",
            token,
            data
        })
        await refetchData();
        setIsLoading(false);
        return true;
    }, [gantts, handleReq, setIsLoading, refetchData, user, token]);

    const handleOnReset = useCallback(async (id: number | string) => {
        setIsLoading(true);
        await handleReq({
            table: "gantt_data",
            route: "update",
            token,
            data: {
                id,
                user_id: user?.id,
                status: "start",
                start: null,
                end: null
            }
        })
        await refetchData();
        setIsLoading(false);
    }, [handleReq, setIsLoading, refetchData, user, token]);

    const handleOnSave = useCallback(async (plan: PlanData, real: RealData, deps: DepsData) : Promise<boolean> => {
        setIsLoading(true);

        const gantt = gantts.find(g => g.id === deps.ganttId);
        if(!gantt){
            setModalText("An unknown error has happened!");
            setIsLoading(false);
            return false;
        }

        const validationPlan = validateSavePlan(plan, gantt, gantts, deps);
        if(!validationPlan.isValid){
            setModalText(validationPlan.message);
            setIsLoading(false);
            return false;
        }

        const validationActual = validateSaveActual(real, gantt, gantts, deps);
        if(!validationActual.isValid){
            setModalText(validationActual.message);
            setIsLoading(false);
            return false;
        };

        const { toCreate, toDelete } = calculateDependencyChanges(gantt.gantt_dependency.map(d => d.dependency_id), deps.dependencies.filter(d => d !== gantt.id));

        const dependencySubmitFunctions = [];
        toCreate.forEach((dep) => {
            dependencySubmitFunctions.push(
                handleReq({
                    table: "gantt_dependency",
                    route: "create",
                    token,
                    data: {
                        gantt_id: deps.ganttId,
                        dependency_id: dep,
                        user_id: user?.id
                    }
                })
            )
        })

        const dependencyDeleteFunctions = [];
        toDelete.forEach((dep) => {
            dependencyDeleteFunctions.push(
                handleReq({
                    table: "gantt_dependency",
                    route: "delete",
                    subroute: "byPairId",
                    token,
                    data: {
                        gantt_id: deps.ganttId,
                        dependency_id: dep
                    }
                })
            )
        })

        await Promise.all([
            handleReq({ table: "gantt_data", route: "update", token, data: {...plan, user_id: user?.id} }),
            handleReq({ table: "gantt_data", route: "update", token, data: {...real, user_id: user?.id} }),
            ...dependencySubmitFunctions,
            ...dependencyDeleteFunctions
        ])
        await refetchData();
        setIsLoading(false);
        return true;
    }, [gantts, handleReq, setIsLoading, refetchData, user, token]);
    
    return (
        <div className="centered-container">
            {isLoading && <Loading />}
            {showHelp && <HelpBubble setShowHelp={setShowHelp} />}

            {modalText != null && (
                <Modal objeto={{
                    titulo: modalText,
                    botao1: {
                        funcao: () => setModalText(null), texto: 'Okay'
                    },
                }} />
            )}

            {confirmResetDatesOfId && (
                <Modal objeto={{
                    titulo: "Are you sure you want to reset the dates of this task?",
                    botao1: {
                        funcao: () => { handleOnReset(confirmResetDatesOfId); setConfirmResetDatesOfId(null); }, texto: 'Confirm'
                    },
                    botao2: {
                        funcao: () => setConfirmResetDatesOfId(null), texto: 'Cancel'
                    },
                }} />
            )}

            <h2 className="smallTitle">Time Management</h2>

            <GanttChart
                tasks={chartData}
                onSave={handleOnSave}
                onStart={(id) => handleOnQuickUpdate(id, "start", (gantt: GanttResType) => validateTaskStart(gantt, gantts))}
                onExecute={(id) => handleOnQuickUpdate(id, "execute", (gantt: GanttResType) => validateTaskExecute(gantt))}
                onComplete={(id) => handleOnQuickUpdate(id, "complete", (gantt: GanttResType) => validateTaskComplete(gantt))}
                onReset={setConfirmResetDatesOfId}
                isEditor={isEditor}
            />
        </div>
    )
}

export const Main = () => (
    <TempoProvider>
        <Content/>
    </TempoProvider>
)