import { useEffect, useState } from "react";
import { GanttChart, Task } from "../../components/ui/GanttChart/GanttChart";
import { useRouter } from "next/router";
import Loading from "../../components/ui/Loading";

export default function GanttPreview() {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [chartData, setChartData] = useState<unknown[]>([]);

    const router = useRouter();

    const { token } = router.query;

    const fetchData = async () => {
        if (!router.isReady) return;

        if (!token) return;

        setIsLoading(true);
        const response = await fetch(`/api/preview/gantt?token=${token}`);
        const ganttData = await response.json();

        const _data = [];
        ganttData.forEach((gantt) => {
            const dependencies = gantt.gantt_dependency.map(g => g.dependency_id);
            const baseObj = {
                ganttId: gantt.id,
                area: gantt.wbs_item.wbs_area.name,
                item: gantt.wbs_item.name,
                color: gantt.wbs_item.wbs_area.color,
                dependencies
            };
            for (let i = 0; i < 2; i++) {
                const start = gantt.gantt_data[i].start;
                const end = gantt.gantt_data[i].end;
                _data.push({
                    ...baseObj,
                    id: gantt.gantt_data[i].id,
                    is_plan: gantt.gantt_data[i].is_plan,
                    start: start ? new Date(`${gantt.gantt_data[i].start}T00:00:00Z`) : null,
                    end: end ? new Date(`${gantt.gantt_data[i].end}T00:00:00Z`) : null,
                    status: gantt.gantt_data[i].status
                })
            }
        })
        setChartData(_data);
        setIsLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, [router, token])

    return (
        <>
            {isLoading && <Loading />}
            <GanttChart
                tasks={chartData as Task[]}
                isEditor={false}
            />
        </>

    )
}

GanttPreview.isPublic = true;