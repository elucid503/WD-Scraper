import { Log, LogLevel } from "sprout-api";

/**
 * Fetches the JSON from Workday's private API.
 */
async function FetchGrades() {

    try {
        
        const Response = await fetch((process.env as any).URL, {

            headers: {

                "Cookie": (process.env as any).COOKIE,
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "X-Workday-Client": "2025.1.0"

            }

        });

        if (!Response.ok) {
            
            throw new Error(`HTTP error! status: ${Response.status}`);

        }

        return await Response.json();

    } catch (Error) {

        console.error(`[${new Date().toISOString()}] Error fetching grades:`, Error);
        return null;

    }
}

/**
 * Parses the Workday JSON.
 */
function ParseGrades(Data: any) {
    
    const Results: { course: string, grade: string }[] = [];

    try {

        // Navigate through the nested structure
        // body -> Institutional View -> panelList -> Active Records View

        const InstitutionalView = Data.body?.children?.[0];
        const ActiveRecordsList = InstitutionalView?.children?.[0];
        const ActiveRecordsPanels = ActiveRecordsList?.panels || [];

        for (const ActiveRecords of ActiveRecordsPanels) {

            // Find the Coursework panel list
            // It's usually in children[1] of the activeRecords panel, or nested in a fieldSet

            const CourseworkPanelList = ActiveRecords.children?.find((Component: any) => 

                Component.widget === "panelList" && (Component.label === "Coursework" || Component.propertyName === "wd:Student_Period_Record_GPA__Updated__Subview")

            ) || ActiveRecords.children?.find((c: any) => c.widget === "fieldSet")?.children?.find((Component: any) => 

                Component.widget === "panelList" && (Component.label === "Coursework" || Component.propertyName === "wd:Student_Period_Record_GPA__Updated__Subview")

            );

            if (!CourseworkPanelList) continue;

            const SemesterPanels = CourseworkPanelList.panels || [];

            for (const Panel of SemesterPanels) {

                // Each panel has a fieldSet child which contains the label and the grid

                const FieldSet = Panel.children?.find((Component: any) => Component.widget === "fieldSet");
                if (!FieldSet) continue;

                const Label = FieldSet.label || "";

                if (Label.includes("Fall Semester 2025")) {

                    // What we want

                    const Grid = FieldSet.children?.find((c: any) => c.widget === "grid" && c.label === "Enrollments");
                    if (!Grid) continue;

                    // Dynamically find column IDs for Course and Grade

                    const CourseCol = Grid.columns?.find((Col: any) => Col.label === "Course" || Col.propertyName === "wd:Course_Listing_Secured--IS");
                    const GradeCol = Grid.columns?.find((col: any) => col.label === "Grade" || col.propertyName === "wd:Student_Grade__Singular_--IS");

                    const CourseColId = CourseCol?.columnId;
                    const GradeColId = GradeCol?.columnId;

                    if (CourseColId && GradeColId) {

                        const Rows = Grid.rows || [];

                        for (const Row of Rows) {

                            const CourseInstance = Row.cellsMap?.[CourseColId]?.instances?.[0];

                            // Only adds if there is a valid course name

                            if (CourseInstance && CourseInstance.text) {

                                const CourseText = CourseInstance.text;
                                const GradeText = Row.cellsMap?.[GradeColId]?.instances?.[0]?.text || "N/A";

                                Results.push({ course: CourseText, grade: GradeText });

                            }

                        }

                    }

                }

            }

        }

    } catch (Error) {

        console.error(`[${new Date().toISOString()}] Error parsing JSON:`, Error);

    }

    return Results;

}

/**
 * Logs the results to the Sprout Logging Relay.
*/
function LogToSprout(Grades: { course: string, grade: string }[]) {

    Log((process.env as any).SERVICE_ID, LogLevel.Info, `${Grades.length} Grades Fetched`, `${Grades.map(g => `${g.course}: <strong>${g.grade}</strong>`).join("<br>")}` ).catch(() => {})

}

/**
 * Logs the results to a text file using Bun.file.
 */
async function LogResults(Grades: { course: string, grade: string }[]) {

    LogToSprout(Grades);

    const LogFile = "grades_log.txt";
    const Timestamp = new Date().toLocaleString();

    let Entry = `--- Log Entry: ${Timestamp} ---\n`;

    if (Grades.length === 0) {

        Entry += "No grades found for Fall 2025.\n";

    } else {

        for (const G of Grades) {

            Entry += `Course: ${G.course.padEnd(40)} | Grade: ${G.grade}\n`;

        }

    }

    Entry += "\n";

    try {

        const File = Bun.file(LogFile);

        let ExistingContent = "";

        if (await File.exists()) {

            ExistingContent = await File.text();

        }
        
        await Bun.write(LogFile, ExistingContent + Entry);
        console.log(`[${Timestamp}] Log updated with ${Grades.length} courses.`);

    } catch (Error) {

        console.error("Error writing to log file:", Error);

    }

}

/**
 * Main execution loop.
 */
async function main() {

    console.log("Starting Workday Grade Scraper...");
    
    const Run = async () => {

        const Data = await FetchGrades();

        if (Data) {

            const Grades = ParseGrades(Data);
            await LogResults(Grades);

        } else {

            console.log("Failed to fetch data, skipping this interval.");

        }
        
    };

    await Run(); // Initial run

    // Periodic runs

    const IntervalMinutes = 5;
    setInterval(Run, IntervalMinutes * 60 * 1000);
    
    console.log(`Scraper is running. Updating every ${IntervalMinutes} minutes. Press Ctrl+C to stop.`);

}

main(); // start